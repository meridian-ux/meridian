"""Read public registry JSON and compare actual archives; never authenticate or retry.

Registry JSON retains the registries' existing schemas. State below lives only
in this process; no parallel release manifest or durable upload ledger is added.
"""

import base64
import hashlib
import json
from typing import NamedTuple
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener


class State(NamedTuple):
    exists: bool
    published: bool


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("registry redirects require investigation")


def fetch(url):
    """Only our fixed HTTPS registry URLs are supplied; send no credentials."""
    request = Request(url, headers={"User-Agent": "Meridian-release-verifier/1.0",
                                    "Cache-Control": "no-cache"})
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            if response.status != 200:
                raise ValueError("unexpected registry response")
            data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024:
                raise ValueError("registry response exceeds verification limit")
            return data
    except HTTPError as error:
        error.close()
        if error.code == 404:
            return None
        raise ValueError(f"registry read failed (HTTP {error.code}); do not publish") from None


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Registry:
    def __init__(self, reader=fetch):
        self.reader = reader

    def document(self, url):
        data = self.reader(url)
        if data is None:
            return None
        value = json.loads(data)
        require(isinstance(value, dict), "invalid registry document")
        return value

    def npm(self, name, version, archive):
        root = self.document("https://registry.npmjs.org/" + quote(name, safe=""))
        if root is None:
            return State(False, False)
        require(root.get("name") == name and isinstance(root.get("versions"), dict)
                and isinstance(root.get("dist-tags"), dict), "invalid npm package identity")
        if version not in root["versions"]:
            return State(True, False)
        package = root["versions"][version]
        require(package.get("name") == name and package.get("version") == version
                and not package.get("deprecated"), "invalid/deprecated npm version")
        data = archive.read_bytes()
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
        url = f"https://registry.npmjs.org/{name}/-/{name.split('/')[-1]}-{version}.tgz"
        require(package.get("dist", {}).get("integrity") == integrity
                and package["dist"].get("tarball") == url, f"npm archive metadata differs: {name}")
        require(self.reader(url) == data, f"npm registry bytes differ: {name}")
        tag = "next" if "-" in version else "latest"
        require(root["dist-tags"].get(tag) == version, f"npm {tag} differs: {name}; owner review required")
        return State(True, True)

    def crate(self, name, version, archive):
        url = f"https://crates.io/api/v1/crates/{name}"
        root = self.document(url)
        if root is None:
            return State(False, False)
        require(root.get("crate", {}).get("id") == name, "invalid crate identity")
        document = self.document(f"{url}/{version}")
        if document is None:
            return State(True, False)
        package = document.get("version", {})
        require(package.get("crate") == name and package.get("num") == version
                and package.get("yanked") is False, "invalid/yanked crate version")
        data = archive.read_bytes()
        require(package.get("checksum") == hashlib.sha256(data).hexdigest(), f"crate checksum differs: {name}")
        url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        require(self.reader(url) == data, f"crate registry bytes differ: {name}")
        return State(True, True)
