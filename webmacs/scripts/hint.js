function clickLike(elem) {
    elem.focus();
    var doc = elem.ownerDocument;
    var view = doc.defaultView;

    var evt = doc.createEvent("MouseEvents");
    evt.initMouseEvent("mousedown", true, true, view, 1, 0, 0, 0, 0, /*ctrl*/ 0, /*event.altKey*/0,
                       /*event.shiftKey*/ 0, /*event.metaKey*/ 0, 0, null);
    elem.dispatchEvent(evt);

    evt = doc.createEvent("MouseEvents");
    evt.initMouseEvent("click", true, true, view, 1, 0, 0, 0, 0, /*ctrl*/ 0, /*event.altKey*/0,
                       /*event.shiftKey*/ 0, /*event.metaKey*/ 0, 0, null);
    elem.dispatchEvent(evt);

    evt = doc.createEvent("MouseEvents");
    evt.initMouseEvent("mouseup", true, true, view, 1, 0, 0, 0, 0, /*ctrl*/ 0, /*event.altKey*/0,
                       /*event.shiftKey*/ 0, /*event.metaKey*/ 0, 0, null);
    elem.dispatchEvent(evt);
}

function rectElementInViewport(elem, w) {  // eslint-disable-line complexity
    var win = elem.ownerDocument.defaultView;
    var rect = elem.getBoundingClientRect();
    w = w || window;

    if (!rect ||
        rect.top > w.innerHeight ||
        rect.bottom < 0 ||
        rect.left > w.innerWidth ||
        rect.right < 0) {
        return null;
    }

    rect = elem.getClientRects()[0];
    if (!rect) {
        return null;
    }

    var style = win.getComputedStyle(elem, null);
    if (style.getPropertyValue("visibility") !== "visible" ||
        style.getPropertyValue("display") === "none" ||
        style.getPropertyValue("opacity") === "0") {
        return null;
    }
    return rect;
}

function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function Hint(obj, manager, left, top, index) {
    this.obj = obj;
    this.objBackground = obj.style.background;
    this.objColor = obj.style.color;
    obj.style.background = manager.options.background;
    obj.style.color = manager.options.text_color;
    this.index = index;
    var hint = document.createElement("span");
    hint.textContent = this.index;
    hint.style.background = manager.options.hint_background;
    hint.style.color = manager.options.hint_color;
    hint.style.position = "absolute";
    hint.style.zIndex = "2147483647";
    hint.style.left = left;
    hint.style.top = top;
    this.hint = hint;
    this.manager = manager;
}

Hint.prototype.text = function() {
    if (this.obj.textContent) {
        return this.obj.textContent;
    }
    return null;
}

Hint.prototype.url = function() {
    if (this.obj.href) {
        return this.obj.href;
    }
    return null;
}

Hint.prototype.remove = function() {
    this.obj.style.background = this.objBackground;
    this.obj.style.color = this.objColor;
    this.hint.parentNode.removeChild(this.hint);
}

Hint.prototype.setVisible = function(on) {
    this.hint.style.display = on ? "initial" : "none";
    this.refresh();
}

Hint.prototype.refresh = function() {
    if (this.isVisible()) {
        if (this.manager.activeHint == this) {
            this.obj.style.background = this.manager.options.background_active;
        } else {
            this.obj.style.background = this.manager.options.background;
        }
        this.obj.style.color = this.manager.options.text_color;
    } else {
        this.obj.style.background = this.objBackground;
        this.obj.style.color = this.objColor;
    }
}

Hint.prototype.isVisible = function() {
    return this.hint.style.display != "none";
}

Hint.prototype.serialize = function() {
    return JSON.stringify({
        nodeName: this.obj.nodeName,
        text: this.text(),
        id: this.hint.textContent,
        url: this.url()
    });
}

class HintFrame {
    constructor(frame) {
        this.frame = frame;
    }

    remove() {
        post_message(this.frame.contentWindow, "hints.select_clear", null);
    }
}

class Hinter {
    constructor() {
        this.options = {
            hint_background: "red",
            hint_color: "white",
            background: "yellow",
            background_active: "#88FF00",
            text_color: "black"
        };
    }

    init(selector) {
        this.selector = selector;
        this.xres = document.evaluate(selector, document, xpath_lookup_namespace,
                                      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                                      null);
        this.fragment = document.createDocumentFragment();
        this.index = 0;
        this.hints = [];
        this.activeHint = null;
        this.__traversedHint = null;
    }

    next(hint_index) {
        // has been cleared.
        if (this.hints === null) {
            return;
        }

        for (; this.index < this.xres.snapshotLength; this.index++) {
            let obj = this.xres.snapshotItem(this.index);
            let rect = rectElementInViewport(obj, window);
            if (!rect) {
                continue;
            }
            if (obj.tagName == "IFRAME") {
                post_message(obj.contentWindow, "hints.select_in_iframe_start",
                             {selector: this.selector, hint_index: hint_index});
                this.hints.push(new HintFrame(obj));
                this.index+=1;
                return;
            }
            hint_index += 1;
            var hint = new Hint(obj, this,
                                (rect.left + window.scrollX) + "px",
                                (rect.top + window.scrollY) + "px",
                                hint_index
                               );
            this.hints.push(hint);
            this.fragment.appendChild(hint.hint);
        }
        document.documentElement.appendChild(this.fragment);

        if (self !== top) {
            post_message(parent, "hints.select_in_iframe_end", hint_index)
        }
    }

    clear() {
        // has been cleared.
        if (this.hints === null) {
            return;
        }
        for (var hint of this.hints) {
            hint.remove();
        }
        this.hints = null;
    }

    frameUpActivateHint(indexes) {
        let index = indexes.shift();
        let hint = this.hints[index];
        let prev = this.activeHint;

        if (hint === prev) {
            return;
        }
        if (prev) {
            this.clearFrameSelection();
        }
        this.activeHint = hint;
        if (top != self) {
            post_message(parent, "hints.frameUpActivateHint", indexes);
        }
    }

    setCurrentActiveHint(hint, prevent) {
        let prevHint = this.activeHint;
        if (hint) {
            this.activeHint = hint;
            hint.refresh();
            post_webmacs_message("_browserObjectActivated", [hint.serialize()]);
        } else if (this.__traversedHint) {
            // we are traversing down, and we found the hint to activate. so we
            // register at this level the frame that contains the active hint.
            this.activeHint = this.__traversedHint;
            this.__traversedHint = null;
        } else {
            this.activeHint = null;
        }
        if (prevHint && prevHint instanceof Hint) {
            prevHint.refresh();
        }
        if (!prevent && self !== top) {
            post_message(parent, "hints.hintActivated");
        }
        return prevHint;
    }

    clearFrameSelection() {
        let prevHint = this.activeHint;
        this.activeHint = null;
        if (prevHint instanceof Hint) {
            prevHint.refresh();
        } else {
            post_message(prevHint.frame.contentWindow, "hints.clearFrameSelection");
        }
    }

    frameActivateNextHint(args) {
        let traverse = function(hinter, index) {
            let hint = hinter.hints[index];
            if (hint instanceof Hint) {
                if (hint.isVisible()) {
                    // mark this hint as activated, and each hint frame in the
                    // upper frames too.
                    hinter.frameUpActivateHint([index].concat(args.parent_indexes));
                    // refresh the hint style to make it appear activated.
                    hint.refresh();
                    // and send hint info to the browser
                    post_webmacs_message("_browserObjectActivated", [hint.serialize()]);
                    return true;
                }
            } else {
                let parent_indexes = args.parent_indexes;
                // this is a hint frame, so go down that frame
                post_message(hint.frame.contentWindow,
                             "hints.frameActivateNextHint", {
                                 // a list of ordered indexes of the calling
                                 // frame hint
                                 parent_indexes: [index].concat(args.parent_indexes),
                                 way: args.way
                             });
                return true;
            }
            return false;
        };


        let index = args.index;
        if (index === undefined) {
            if (this.activeHint) {
                // just go down on the current hint if it is a frame
                index = this.hints.indexOf(this.activeHint);

                // else, activate the next hint
                if (this.activeHint instanceof Hint) {
                    index += args.way;
                    // if we are out of bounds, and that this is the main frame,
                    // just loop.
                    if (self == top) {
                        if (index === -1 || index >= this.hints.length) {
                            index = args.way == 1 ? 0: this.hints.length - 1;
                        }
                    }
                }
            } else {
                // if no selection, select the first one
                index = args.way == 1 ? 0: this.hints.length - 1;
            }
        }

        if (args.way === 1) {
            for (; index < this.hints.length; index++) {
                if (traverse(this, index)) {
                    return;
                }
            }
        } else {
            for (; index >= 0; index--) {
                if (traverse(this, index)) {
                    return;
                }
            }
        }

        // we found no selection if we are here
        if (self !== top) {
            // recall the parent frame
            post_message(parent, "hints.frameActivateNextHint", {
                index: args.parent_indexes[0] + args.way,
                way: args.way
            });
        }
    }

    activateNextHint(backward) {
        this.frameActivateNextHint({
            way: backward ? -1 : 1,
            parent_indexes: [],
        });
    }

    followCurrentLink() {
        if (this.activeHint) {
            if (this.activeHint instanceof Hint) {
                clickLike(this.activeHint.obj);
            } else {
                post_message(this.activeHint.frame.contentWindow,
                             "hints.followCurrentLink");
            }
        }
    }

    selectVisibleHint(index) {
        var frameHint = null;
        this.__traversedHint = null;
        for (var hint of this.hints) {
            if (hint instanceof Hint) {
                let nb = parseInt(hint.hint.textContent);
                if (nb === index) {
                    let prev = this.setCurrentActiveHint(hint);
                    // to clear any other hint on a subframe
                    if (prev instanceof HintFrame) {
                        this.activeHint = prev;
                        this.clearFrameSelection();
                        this.activeHint = hint;
                    }
                    return;
                } else if (nb > index) {
                    if (frameHint) {
                        this.__traversedHint = frameHint;
                        post_message(frameHint.frame.contentWindow,
                                     "hints.selectVisibleHint", index);
                    }
                    return;
                }
            } else {
                frameHint = hint;
            }
        }
        this.__traversedHint = null;
        if (self === top) {
            this.setCurrentActiveHint(null);
        }
    }

    frameFilterSelection(args) {
        let hint_index = args.hint_index;

        // match everything when text selector is empty
        let match_hint = hint => true;

        if (args.text) {
            // else, we fuzzy-match on the hint text
            let parts = args.text.split(/\s+/).map(escapeRegExp);
            let re = new RegExp(".*" + parts.join(".*") + ".*", "i");
            match_hint = function(hint) {
                let text = hint.text();
                if (text !== null) {
                    return (text.match(re) !== null);
                }
                return false;
            };
        }

        for (let index = args.index; index < this.hints.length; index++) {
            let hint = this.hints[index];
            if (hint instanceof HintFrame) {
                // iframe, let's go down
                post_message(hint.frame.contentWindow, "hints.frameFilterSelection", {
                    text: args.text,
                    index: 0,
                    parent_index: index,
                    hint_index: hint_index
                });
                return;
            }

            // else see if we match the hint, and update its visibility
            if (match_hint(hint)) {
                hint_index +=1;
                hint.setVisible(true);
                hint.hint.textContent = hint_index;
            } else {
                hint.setVisible(false);
                if (hint == this.activeHint) {
                    this.clearFrameSelection();
                }
            }
        }

        if (self !== top) {
            // if we are in a sub frame, we call back the parent so he will
            // continue.
            post_message(parent, "hints.frameFilterSelection", {
                text: args.text,
                index: args.parent_index + 1,
                hint_index: hint_index
            });
        } else {
            // else if we lose the selection, put it back to the first hint.
            if (this.activeHint === null) {
                this.activateNextHint(false);
            }
        }
    }

    filterSelection(text) {
        this.frameFilterSelection({
            text: text,
            index: 0,
            hint_index: 0,
        });
    }
}

var hinter = new Hinter();

function HintManager() {
    this.hints = [];
    this.options = {
        hint_background: "red",
        hint_color: "white",
        background: "yellow",
        background_active: "#88FF00",
        text_color: "black"
    };
    this.activeHint = null;
}

// took from conkeror
XHTML_NS = "http://www.w3.org/1999/xhtml";
XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
MATHML_NS = "http://www.w3.org/1998/Math/MathML";
XLINK_NS = "http://www.w3.org/1999/xlink";
SVG_NS = "http://www.w3.org/2000/svg";

function xpath_lookup_namespace (prefix) {
    return {
        xhtml: XHTML_NS,
        m: MATHML_NS,
        xul: XUL_NS,
        svg: SVG_NS
    }[prefix] || null;
}

HintManager.prototype.selectBrowserObjects = function(selector, hint_index) {
    // Object.assign(this.options, options || {});
    hinter.init(selector);
    hinter
    hinter.next(hint_index || 0);
    hinter.activateNextHint(false);
    // this.setActiveHint((this.hints.length > 0) ? this.hints[0] : null);
}

HintManager.prototype.setActiveHint = function(hint) {
    var prevActive = this.activeHint;
    this.activeHint = hint;
    if (prevActive) { prevActive.refresh(); }
    if (hint) {
        hint.refresh();
        __webmacsHandler__._browserObjectActivated(hint.serialize());
    }
}

HintManager.prototype.visibleHints = function() {
    let visibles = [];
    for (let hint of this.hints) {
        if (hint.isVisible()) {
            visibles.push(hint);
        }
    }
    return visibles;
}

HintManager.prototype.selectVisibleHint = function(index) {
    hinter.selectVisibleHint(parseInt(index));
}

HintManager.prototype.activateNextHint = function(backward) {
    hinter.activateNextHint(backward);
}

HintManager.prototype.filterSelection = function(text) {
    hinter.filterSelection(text);
}

HintManager.prototype.clearBrowserObjects = function() {
    hinter.clear();
}

var hints = new HintManager();

if (self === top) {
    // var all_hints = [];

    // function register_hints() {};

    // window.addEventListener("load", function() {
    //     register_message_handler("hints.register_hints", register_hints);
    // });
} else {
    register_message_handler("hints.select_in_iframe_start", function(args) {
        hinter.init(args.selector);
        hinter.next(args.hint_index);
    });
    register_message_handler("hints.select_clear",
                             _ => hinter.clear());
    register_message_handler("hints.clearFrameSelection",
                             _ => hinter.clearFrameSelection());
}
register_message_handler("hints.select_in_iframe_end",
                         hint_index => hinter.next(hint_index));
register_message_handler("hints.frameActivateNextHint",
                         args => hinter.frameActivateNextHint(args));
register_message_handler("hints.hintActivated",
                         _ => hinter.setCurrentActiveHint());
register_message_handler("hints.followCurrentLink",
                         _ => hinter.followCurrentLink());
register_message_handler("hints.selectVisibleHint",
                         index => hinter.selectVisibleHint(index));
register_message_handler("hints.frameFilterSelection",
                         args => hinter.frameFilterSelection(args));
register_message_handler("hints.frameUpActivateHint",
                         args => hinter.frameUpActivateHint(args));
