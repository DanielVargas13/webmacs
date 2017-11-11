import os

from PyQt5.QtWebEngineWidgets import QWebEngineProfile, QWebEngineScript
from PyQt5.QtCore import QFile, QTextStream

from .scheme_handlers.webmacs import WebmacsSchemeHandler
from .visited_links import VisitedLinks
from .autofill import Autofill
from .autofill.db import PasswordDb
from .ignore_certificates import IgnoredCertificates


THIS_DIR = os.path.dirname(os.path.realpath(__file__))


class Profile(object):
    def __init__(self, name, q_profile=None):
        self.name = name
        if q_profile is None:
            q_profile = QWebEngineProfile.defaultProfile()

        self.q_profile = q_profile

        self._scheme_handlers = {}  # keep a python reference

    def enable(self, app):
        path = os.path.join(app.profiles_path(), self.name)
        if not os.path.isdir(path):
            os.makedirs(path)

        self.q_profile.setRequestInterceptor(app.url_interceptor())

        for handler in (WebmacsSchemeHandler,):
            h = handler(app)
            self._scheme_handlers[handler.scheme] = h
            self.q_profile.installUrlSchemeHandler(handler.scheme, h)

        self.q_profile.setPersistentStoragePath(path)
        self.q_profile.setPersistentCookiesPolicy(
            QWebEngineProfile.ForcePersistentCookies)

        self.session_file = os.path.join(path, "session.json")

        self.visitedlinks \
            = VisitedLinks(os.path.join(path, "visitedlinks.db"))
        self.autofill \
            = Autofill(PasswordDb(os.path.join(path, "autofill.db")))
        self.ignored_certs \
            = IgnoredCertificates(os.path.join(path, "ignoredcerts.db"))

        self.q_profile.setCachePath(os.path.join(path, "cache"))
        self.q_profile.downloadRequested.connect(
            app.download_manager().download_requested
        )

        def inject_js(src, ipoint=QWebEngineScript.DocumentCreation,
                      iid=QWebEngineScript.ApplicationWorld):
            script = QWebEngineScript()
            script.setInjectionPoint(ipoint)
            script.setSourceCode(src)
            script.setWorldId(iid)
            self.q_profile.scripts().insert(script)

        for script in (":/qtwebchannel/qwebchannel.js",
                       os.path.join(THIS_DIR, "scripts", "textedit.js"),
                       os.path.join(THIS_DIR, "scripts", "autofill.js"),
                       os.path.join(THIS_DIR, "scripts", "setup.js"),):
            f = QFile(script)
            assert f.open(QFile.ReadOnly | QFile.Text)
            inject_js(QTextStream(f).readAll())

    def load_session(self):
        from .session import Session
        if os.path.exists(self.session_file):
            with open(self.session_file, "r") as f:
                Session.load(f).apply()
                return True

    def save_session(self):
        from .session import Session
        with open(self.session_file, "w") as f:
            Session().save(f)


def default_profile():
    return Profile("default")
