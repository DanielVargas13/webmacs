from PyQt5.QtWidgets import QWidget, QLineEdit, QHBoxLayout, QLabel, \
    QTableView, QHeaderView, QApplication
from PyQt5.QtCore import pyqtSignal as Signal, \
    QPoint, QEvent, QSortFilterProxyModel, QRegExp, Qt, QModelIndex

from .keymap import KEYMAP, current_minibuffer  # noqa
from .prompt import PromptTableModel, Prompt, YesNoPrompt  # noqa


class Popup(QTableView):
    def __init__(self):
        QTableView.__init__(self)
        self.setParent(None, Qt.Popup)
        self.setFocusPolicy(Qt.NoFocus)
        self.horizontalHeader().hide()
        self.verticalHeader().hide()
        self.verticalHeader().setSectionResizeMode(QHeaderView.Fixed)
        self.verticalHeader().setDefaultSectionSize(24)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setEditTriggers(QTableView.NoEditTriggers)
        self.setSelectionBehavior(QTableView.SelectRows)
        self.setSelectionMode(QTableView.SingleSelection)
        self.setShowGrid(False)
        self._max_visible_items = 10

    def popup(self, widget):
        h = (24) * min(self._max_visible_items, self.model().rowCount()) + 3

        w = widget.width()
        pos = widget.mapToGlobal(QPoint(0, -h))

        self.setGeometry(pos.x(), pos.y(), w, h)

        cols = self.model().columnCount()
        col_width = w / cols
        for i in range(cols):
            self.setColumnWidth(i, col_width)

        if not self.isVisible():
            self.show()


class MinibufferInput(QLineEdit):
    completion_activated = Signal(QModelIndex)

    FuzzyMatch = Prompt.FuzzyMatch
    SimpleMatch = Prompt.SimpleMatch

    def __init__(self, parent=None):
        QLineEdit.__init__(self, parent)
        self._completer_model = None
        self._popup = Popup()
        self.textEdited.connect(self._show_completions)
        self._popup.installEventFilter(self)
        self.installEventFilter(self)
        self._eat_focusout = False
        self._proxy_model = QSortFilterProxyModel(self)
        self._proxy_model.setFilterKeyColumn(-1)
        self._popup.setModel(self._proxy_model)
        self._popup.activated.connect(self._on_completion_activated)
        self._popup.selectionModel().currentRowChanged.connect(
            self._on_row_changed)
        self._mark = False
        self.configure_completer({})

        from ..keyboardhandler import LOCAL_KEYMAP_SETTER
        LOCAL_KEYMAP_SETTER.register_minibuffer_input(self)

    def configure_completer(self, opts):
        self._popup._max_visible_items = opts.get("max-visible-items", 10)
        self._match = opts.get("match", self.SimpleMatch)
        self._autocomplete_single = opts.get("autocomplete-single", True)
        self._autocomplete = opts.get("autocomplete", False)
        if self._autocomplete:
            self._autocomplete_single = False
        self._complete_empty = opts.get("complete-empty", False)

    def keymap(self):
        prompt = self.parent()._prompt
        if prompt and prompt.keymap:
            return prompt.keymap
        return KEYMAP

    def eventFilter(self, obj, event):
        etype = event.type()
        if etype == QEvent.FocusOut and obj == self and self._eat_focusout \
           and self._popup.isVisible():
            # keep the focus on the line edit
            return True
        elif etype == QEvent.MouseButtonPress:
            # if we've clicked in the widget (or its descendant), let it handle
            # the click
            pos = obj.mapToGlobal(event.pos())
            target = QApplication.widgetAt(pos)
            if target and (self.isAncestorOf(target) or target == self):
                if not self._popup.underMouse():
                    self._popup.hide()
                target.event(event)
                return True

            if not self._popup.underMouse():
                self._popup.hide()
                return True
        elif etype in (QEvent.KeyPress, QEvent.KeyRelease):
            # send event to the line edit
            self._eat_focusout = True
            self.event(event)
            self._eat_focusout = False
            return True

        return QLineEdit.eventFilter(self, obj, event)

    def set_completer_model(self, completer_model):
        self._proxy_model.setSourceModel(completer_model)

    def completer_model(self):
        return self._proxy_model.sourceModel()

    def set_match(self, type):
        self._match = type
        if self._popup.isVisible():
            self._show_completions(self.text)

    def _on_row_changed(self, current, old):
        if self._autocomplete:
            self.complete(hide_popup=False)

    def _show_completions(self, txt, force=False):
        force = force or self._complete_empty
        if self._match == self.SimpleMatch:
            pattern = "^" + QRegExp.escape(txt)
        else:
            pattern = ".*".join(QRegExp.escape(t) for t in txt.split())

        self._proxy_model.setFilterRegExp(QRegExp(pattern, Qt.CaseInsensitive))
        if self._proxy_model.rowCount() == 0:
            self._popup.hide()
        elif not txt and not force:
            self._popup.hide()
        else:
            self._popup.popup(self)

    def show_completions(self):
        self._show_completions(self.text(), True)

    def _on_completion_activated(self, index, hide_popup=True):
        if hide_popup:
            self._popup.hide()
        model = index.model()
        if index.column() != 0:
            index = model.index(index.row(), 0)

        self.setText(model.data(index))
        self.completion_activated.emit(model.mapToSource(index))

    def popup(self):
        return self._popup

    def complete(self, hide_popup=True):
        if not self._popup.isVisible():
            return

        index = self._popup.selectionModel().currentIndex()
        if index.isValid():
            self._on_completion_activated(index, hide_popup=hide_popup)
        elif self._autocomplete_single and self._proxy_model.rowCount() == 1:
            self._on_completion_activated(self._proxy_model.index(0, 0),
                                          hide_popup=hide_popup)

    def select_next_completion(self, forward=True):
        model = self._proxy_model
        entries = model.rowCount()
        if entries == 0:
            return

        selection = self._popup.selectionModel().currentIndex()
        if not selection.isValid():
            row = 0 if forward else (entries - 1)
        else:
            row = selection.row()
            if forward:
                row = row + 1
                if row >= entries:
                    row = 0
            else:
                row = row - 1
                if row < 0:
                    row = (entries - 1)

        self._popup.selectRow(row)

    def mark(self):
        return self._mark

    def set_mark(self, value=None):
        if value is None:
            value = not self._mark
        self._mark = value
        return self._mark


class Minibuffer(QWidget):
    def __init__(self, window):
        QWidget.__init__(self, window)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.setLayout(layout)

        self.label = QLabel(self)
        layout.addWidget(self.label)

        self._input = MinibufferInput(self)
        layout.addWidget(self._input)

        self._input.hide()
        self._prompt = None

    def input(self):
        return self._input

    def prompt(self):
        return self._prompt

    def do_prompt(self, prompt):
        self.close_prompt()
        self._prompt = prompt
        if prompt:
            prompt.enable(self)
            prompt.closed.connect(self._prompt_closed)
            prompt.closed.connect(prompt.deleteLater)

    def close_prompt(self):
        if self._prompt:
            self._prompt.close()
            self._prompt = None

    def _prompt_closed(self):
        self._prompt = None
