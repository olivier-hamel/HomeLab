"""Mastery presets shared by the study selector and advanced settings."""
from dataclasses import replace

from .study_engine import StudyConfig


# Only mastery requirements change; group size and response preferences stay intact.
_KEYS = (
    "mastery_threshold", "minimum_successful_recalls", "minimum_active_recall_successes",
    "minimum_spaced_recalls", "minimum_spacing_questions", "minimum_spacing",
    "incorrect_answer_penalty",
)
_NORMAL = StudyConfig()
MASTERY_PRESETS = {
    "relaxed": {
        "mastery_threshold": .50,
        "minimum_successful_recalls": 2,
        "minimum_active_recall_successes": 1,
        "minimum_spaced_recalls": 1,
        "minimum_spacing_questions": 1,
        "minimum_spacing": 1,
        "incorrect_answer_penalty": .35,
    },
    "normal": {key: getattr(_NORMAL, key) for key in _KEYS},
    "strict": {
        "mastery_threshold": .95,
        "minimum_successful_recalls": 5,
        "minimum_active_recall_successes": 3,
        "minimum_spaced_recalls": 4,
        "minimum_spacing_questions": 5,
        "minimum_spacing": 600,
        "incorrect_answer_penalty": .70,
    },
}


def with_difficulty(config, difficulty):
    if difficulty not in MASTERY_PRESETS:
        raise ValueError("Unknown mastery difficulty")
    return replace(config, **MASTERY_PRESETS[difficulty])


def current_difficulty(config):
    return next((name for name, values in MASTERY_PRESETS.items()
                 if all(getattr(config, key) == value for key, value in values.items())), None)
