"""Exercise deployment control flow using real Git repositories and fake Docker."""

import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("deploy-server.sh")
BRANCH = "feat/memo-integration"
FAKE_DOCKER = """#!/usr/bin/env python3
import json, os, pathlib, sys
arguments = sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'], 'a') as log:
    log.write(json.dumps(arguments) + '\\n')
if arguments[:1] == ['compose']:
    arguments = arguments[3:]
if arguments[:1] == [os.environ.get('FAKE_DOCKER_FAIL')]:
    print('Simulated Docker failure', file=sys.stderr)
    sys.exit(7)
if arguments == ['config', '--services']:
    print('frontend\\nbackend\\ncalendar\\nmemo')
"""


class DeployServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="homelab-deploy-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "origin.git"
        self.developer = self.root / "developer"
        self.server = self.root / "server checkout"
        self.docker_log = self.root / "docker.jsonl"
        self.environment = dict(os.environ)
        for key in list(self.environment):
            if key.startswith("DEPLOY_") or key.startswith("GIT_"):
                del self.environment[key]
        self.environment.update({
            "DEPLOY_REPO_DIR": str(self.server),
            "DEPLOY_REMOTE": "origin",
            "DEPLOY_BRANCH": BRANCH,
            "DEPLOY_WAIT_TIMEOUT": "23",
            "FAKE_DOCKER_LOG": str(self.docker_log),
        })
        self.git("init", "--bare", str(self.remote))
        self.git("init", "-b", BRANCH, str(self.developer))
        self.configure_author(self.developer)
        (self.developer / ".gitignore").write_text(".env*\ndata/\n")
        (self.developer / "compose.yml").write_text("services: {}\n")
        (self.developer / "app.txt").write_text("initial\n")
        self.git("add", ".", cwd=self.developer)
        self.git("commit", "-m", "Initial app", cwd=self.developer)
        self.git("remote", "add", "origin", str(self.remote), cwd=self.developer)
        self.git("push", "origin", BRANCH, cwd=self.developer)
        self.git("clone", "--branch", BRANCH, str(self.remote), str(self.server))
        self.configure_author(self.server)
        self.git("checkout", "-b", "deploy/memo-dashboard", cwd=self.server)
        (self.server / "backend").mkdir()
        (self.server / "data").mkdir()
        self.private_files = {
            ".env": "COMPOSE_PROJECT_NAME=homelab\n",
            "backend/.env": "PRIVATE_VALUE=keep-this\n",
            "data/persistent.txt": "keep data\n",
        }
        for name, contents in self.private_files.items():
            (self.server / name).write_text(contents)
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        fake_docker = fake_bin / "docker"
        fake_docker.write_text(FAKE_DOCKER)
        fake_docker.chmod(0o755)
        self.environment["PATH"] = f"{fake_bin}:{os.environ['PATH']}"
        self.marker = self.server / ".git/homelab-deploy/last-successful-commit"

    def git(self, *arguments, cwd=None):
        return subprocess.run(
            ["git", *arguments], cwd=cwd, env=self.environment,
            text=True, capture_output=True, check=True, timeout=10,
        ).stdout.strip()

    def configure_author(self, repository):
        self.git("config", "user.name", "Deployment test", cwd=repository)
        self.git("config", "user.email", "deploy@example.invalid", cwd=repository)

    def commit_update(self, contents, *, push=True, repository=None):
        repository = repository or self.developer
        (repository / "app.txt").write_text(contents)
        self.git("add", "app.txt", cwd=repository)
        self.git("commit", "-m", contents, cwd=repository)
        if push:
            self.git("push", "origin", BRANCH, cwd=repository)
        return self.git("rev-parse", "HEAD", cwd=repository)

    def deploy(self, *arguments, failure=None, script=SCRIPT):
        self.docker_log.write_text("")
        environment = dict(self.environment)
        if failure:
            environment["FAKE_DOCKER_FAIL"] = failure
        return subprocess.run(
            ["bash", str(script), *arguments], env=environment,
            text=True, capture_output=True, timeout=15,
        )

    def docker_commands(self):
        return [json.loads(line) for line in self.docker_log.read_text().splitlines()]

    def compose_commands(self):
        return [arguments[3:] for arguments in self.docker_commands()
                if arguments[:1] == ["compose"]]

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_deploys_latest_pushed_commit_and_preserves_private_files(self):
        self.commit_update("first pushed update")
        pushed = self.commit_update("latest pushed update")
        self.commit_update("unpushed local update", push=False)
        self.assert_success(self.deploy())
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), pushed)
        self.assertEqual(self.git("branch", "--show-current", cwd=self.server),
                         "deploy/memo-dashboard")
        self.assertEqual(self.marker.read_text().strip(), pushed)
        self.assertEqual(self.git("status", "--porcelain", cwd=self.server), "")
        for name, contents in self.private_files.items():
            self.assertEqual((self.server / name).read_text(), contents)
        commands = self.compose_commands()
        self.assertEqual([args for args in commands if args[0] == "build"], [
            ["build", "frontend"], ["build", "backend"],
            ["build", "calendar"], ["build", "memo"],
        ])
        validation = ["run", "--rm", "--no-deps", "-T", "frontend", "caddy",
                      "validate", "--config", "/config/runtime.json"]
        rollout = ["up", "-d", "--no-build", "--wait", "--wait-timeout", "23"]
        self.assertLess(commands.index(validation), commands.index(rollout))
        self.assertFalse(any(args[0] == "down" for args in commands))

    def test_successful_commit_is_skipped_until_forced(self):
        self.assert_success(self.deploy())
        result = self.deploy()
        self.assert_success(result)
        self.assertIn("Already deployed", result.stdout)
        self.assertEqual(self.docker_commands(), [])
        self.assert_success(self.deploy("--force"))
        rollout = next(args for args in self.compose_commands() if args[0] == "up")
        self.assertIn("--force-recreate", rollout)

    def test_build_and_validation_failures_do_not_roll_out_and_are_retried(self):
        for failure in ("config", "build", "run"):
            with self.subTest(failure=failure):
                if self.marker.exists():
                    self.marker.unlink()
                result = self.deploy(failure=failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("not marked deployed", result.stderr)
                self.assertFalse(self.marker.exists())
                self.assertFalse(any(args[0] == "up" for args in self.compose_commands()))
                self.assert_success(self.deploy())
                self.assertTrue(self.marker.exists())

    def test_health_failure_preserves_previous_success_and_retries_same_head(self):
        self.assert_success(self.deploy())
        previous = self.marker.read_text()
        pushed = self.commit_update("new release")
        self.assertNotEqual(self.deploy(failure="up").returncode, 0)
        self.assertEqual(self.marker.read_text(), previous)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), pushed)
        self.assert_success(self.deploy())
        self.assertEqual(self.marker.read_text().strip(), pushed)
        self.assertTrue(any(args[0] == "build" for args in self.compose_commands()))

    def test_dirty_checkout_is_left_untouched(self):
        old_head = self.git("rev-parse", "HEAD", cwd=self.server)
        self.commit_update("remote change")
        self.git("config", "status.showUntrackedFiles", "no", cwd=self.server)
        for path in ("app.txt", "untracked.txt"):
            with self.subTest(path=path):
                (self.server / path).write_text("server-only edits")
                result = self.deploy()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("local changes", result.stderr)
                self.assertEqual((self.server / path).read_text(), "server-only edits")
                self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), old_head)
                self.assertEqual(self.docker_commands(), [])
                if path == "app.txt":
                    self.git("restore", "app.txt", cwd=self.server)
                else:
                    (self.server / path).unlink()

    def test_ahead_or_diverged_server_history_is_refused(self):
        local_head = self.commit_update("server-only commit", push=False, repository=self.server)
        for diverged in (False, True):
            with self.subTest(diverged=diverged):
                if diverged:
                    self.commit_update("different remote commit")
                result = self.deploy()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ahead of or diverges", result.stderr)
                self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), local_head)
                self.assertEqual(self.docker_commands(), [])

    def test_detached_checkout_is_refused(self):
        self.git("checkout", "--detach", cwd=self.server)
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("detached HEAD", result.stderr)
        self.assertFalse(self.marker.exists())

    def test_unreachable_remote_does_not_deploy(self):
        old_head = self.git("rev-parse", "HEAD", cwd=self.server)
        self.git("remote", "set-url", "origin", str(self.root / "missing.git"), cwd=self.server)
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), old_head)
        self.assertFalse(self.marker.exists())
        self.assertEqual(self.docker_commands(), [])

    def test_concurrent_invocation_skips_without_touching_git_or_docker(self):
        self.marker.parent.mkdir()
        self.commit_update("new pushed commit")
        old_head = self.git("rev-parse", "HEAD", cwd=self.server)
        with (self.marker.parent / "deploy.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.deploy()
        self.assert_success(result)
        self.assertIn("Another deployment", result.stdout)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.server), old_head)
        self.assertEqual(self.docker_commands(), [])

    def test_invalid_timeout_is_refused_before_deploying(self):
        self.environment["DEPLOY_WAIT_TIMEOUT"] = "0"
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("positive integer", result.stderr)
        self.assertEqual(self.docker_commands(), [])

    def test_missing_private_configuration_does_not_start_a_rollout(self):
        (self.server / "backend/.env").unlink()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existing .env and backend/.env", result.stderr)
        self.assertFalse(self.marker.exists())
        self.assertFalse(any(args[0] in ("build", "run", "up")
                             for args in self.compose_commands()))

    def test_running_script_can_be_replaced_by_the_pushed_commit(self):
        scripts = self.developer / "scripts"
        scripts.mkdir()
        pushed_script = scripts / "deploy-server.sh"
        pushed_script.write_text(SCRIPT.read_text())
        self.git("add", "scripts/deploy-server.sh", cwd=self.developer)
        self.git("commit", "-m", "Add deployment script", cwd=self.developer)
        self.git("push", "origin", BRANCH, cwd=self.developer)
        self.assert_success(self.deploy())

        # The active invocation must finish the version already parsed, even
        # when Git replaces its source with a completely different script.
        pushed_script.write_text("#!/usr/bin/env bash\nexit 99\n" + "# New version\n" * 2000)
        self.git("add", "scripts/deploy-server.sh", cwd=self.developer)
        self.git("commit", "-m", "Replace deployment script", cwd=self.developer)
        self.git("push", "origin", BRANCH, cwd=self.developer)
        pushed = self.git("rev-parse", "HEAD", cwd=self.developer)
        self.assert_success(self.deploy(script=self.server / "scripts/deploy-server.sh"))
        self.assertEqual(self.marker.read_text().strip(), pushed)
        self.assertTrue(any(args[0] == "up" for args in self.compose_commands()))


if __name__ == "__main__":
    unittest.main()
