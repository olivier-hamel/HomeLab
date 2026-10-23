import unittest
from base64 import b64decode
from hashlib import sha256
from library_download import register_download_tool, _cache


class FakeMcp:
    def tool(self):
        return lambda function: function


class FakeClient:
    def list_courses(self):
        return [{"id": 42}]

    def _course_files(self, course):
        return [{"id": "7:0", "filename": "cours.pdf", "filesize": len(CONTENT), "_url": "private"}]

    def _download(self, url):
        return CONTENT


CONTENT = b"%PDF-1.7\n" + b"x" * 600000


class ExportTest(unittest.TestCase):
    def setUp(self):
        _cache.clear()
        self.download = register_download_tool(FakeMcp(), FakeClient)

    def test_roundtrip_and_integrity(self):
        first = self.download(42, "7:0")
        self.assertFalse(first["eof"])
        last = self.download(42, "7:0", offset=512 * 1024, sha256=first["sha256"])
        result = b64decode(first["data_base64"]) + b64decode(last["data_base64"])
        self.assertEqual(result, CONTENT)
        self.assertTrue(last["eof"])
        self.assertEqual(first["sha256"], sha256(CONTENT).hexdigest())

    def test_membership_pairing_and_bounds(self):
        for args in [(43, "7:0"), (42, "other"), (42, "7:0", -1), (42, "7:0", 0, 600000)]:
            with self.assertRaises(ValueError):
                self.download(*args)
        first = self.download(42, "7:0")
        with self.assertRaises(ValueError):
            self.download(42, "7:0", offset=1, sha256="wrong")
        self.assertEqual(len(b64decode(first["data_base64"])), 512 * 1024)


if __name__ == "__main__":
    unittest.main()
