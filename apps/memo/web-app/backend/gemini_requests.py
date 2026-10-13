"""Project-wide pacing and bounded retries for interactive Gemini requests."""
import asyncio
import math
import os
import re
import time
from collections import deque

from .decks import DeckError


def quota_details(response):
    """Read structured provider errors without exposing their messages or secrets."""
    kind, retry_after = "unknown", None
    try:
        details = response.json().get("error", {}).get("details", [])
        for detail in details:
            if detail.get("@type", "").endswith("QuotaFailure"):
                for violation in detail.get("violations", []):
                    identifier = str(violation.get("quotaId", "")).lower()
                    if str(violation.get("quotaValue", "")) == "0":
                        kind = "unavailable"
                    elif kind != "unavailable" and ("perday" in identifier or "daily" in identifier):
                        kind = "daily"
                    elif kind == "unknown" and "perminute" in identifier:
                        kind = "minute"
            elif detail.get("@type", "").endswith("RetryInfo"):
                delay = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(detail.get("retryDelay", "")))
                if delay:
                    retry_after = float(delay[1])
        header = response.headers.get("retry-after", "")
        if header.replace(".", "", 1).isdigit():
            retry_after = max(retry_after or 0, float(header))
    except (AttributeError, TypeError, ValueError):
        pass
    return kind, retry_after


def quota_error(response):
    kind, _ = quota_details(response)
    if kind == "daily":
        return DeckError(429, "Le quota quotidien du service est épuisé. Réessaie après sa réinitialisation ou contacte l’administrateur.")
    if kind == "unavailable":
        return DeckError(429, "Le service n’a aucun quota disponible. L’administrateur doit vérifier sa configuration.")
    if kind == "minute":
        return DeckError(429, "La limite du service par minute est atteinte. Attends un peu puis réessaie.")
    return DeckError(429, "Le service a atteint une limite de quota. Contacte l’administrateur avant de réessayer.")


class GeminiRequests:
    def __init__(self, rpm=None, tpm=None, retry_limit=2, *, now=time.monotonic, sleep=asyncio.sleep):
        self.rpm = float(os.environ.get("MEMO_GEMINI_RPM", "10")) if rpm is None else rpm
        self.tpm = int(os.environ.get("MEMO_GEMINI_TPM", "250000")) if tpm is None else tpm
        if not math.isfinite(self.rpm) or self.rpm < 0 or self.tpm < 0:
            raise ValueError("Gemini rate limits must be non-negative")
        self.retry_limit, self.now, self.sleep = retry_limit, now, sleep
        self.lock = asyncio.Lock()
        self.starts = deque()
        self.last_start = None
        self.cooldown_until = 0

    async def reserve(self, tokens):
        if self.tpm and tokens > self.tpm:
            raise DeckError(413, "Cette étape dépasse la capacité configurée du service. L’administrateur doit vérifier sa configuration.")
        while True:
            async with self.lock:
                now = self.now()
                while self.starts and self.starts[0][0] + 60 <= now:
                    self.starts.popleft()
                ready = self.cooldown_until
                if self.rpm and self.last_start is not None:
                    ready = max(ready, self.last_start + 60 / self.rpm + .05)
                if self.tpm and sum(item[1] for item in self.starts) + tokens > self.tpm:
                    ready = max(ready, self.starts[0][0] + 60.05)
                if ready <= now:
                    reservation = [now, tokens]
                    self.starts.append(reservation)
                    self.last_start = now
                    return reservation
                delay = ready - now
            await self.sleep(delay)

    async def post(self, client, url, *, headers, json, input_tokens=None):
        # Conservative input estimate; the real provider count replaces it on success.
        parts = json.get("contents", [{}])[0].get("parts", [])
        text_bytes = sum(len(part.get("text", "").encode()) for part in parts)
        system_bytes = sum(len(part.get("text", "").encode()) for part in json.get("systemInstruction", {}).get("parts", []))
        estimate = input_tokens if input_tokens is not None else math.ceil((text_bytes + system_bytes) / 2) + sum(8192 for part in parts if "fileData" in part)
        for attempt in range(self.retry_limit + 1):
            reservation = await self.reserve(estimate)
            response = await client.post(url, headers=headers, json=json)
            if response.status_code != 429:
                try:
                    actual = response.json().get("usageMetadata", {}).get("promptTokenCount")
                    if isinstance(actual, int) and actual >= 0:
                        reservation[1] = actual
                except (AttributeError, TypeError, ValueError):
                    pass
                return response
            kind, retry_after = quota_details(response)
            # Daily/zero quotas cannot be fixed by immediate retries.
            if kind in ("daily", "unavailable") or (kind == "unknown" and retry_after is None):
                raise quota_error(response)
            if attempt >= self.retry_limit:
                raise quota_error(response)
            async with self.lock:
                self.cooldown_until = max(self.cooldown_until, self.now() + max(1, retry_after or 60) + 1)
        raise AssertionError("unreachable")
