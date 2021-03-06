var firepad = firepad || { };

firepad.Firepad = (function (global) {
    if (!firepad.RichTextCodeMirrorAdapter) {
        throw new Error("Oops! It looks like you're trying to include lib/firepad.js directly.  This is actually one of many source files that make up firepad.  You want dist/firepad.js instead.");
    }
    var RichTextCodeMirrorAdapter = firepad.RichTextCodeMirrorAdapter;
    var RichTextCodeMirror = firepad.RichTextCodeMirror;
    var RichTextToolbar = firepad.RichTextToolbar;
    var ACEAdapter = firepad.ACEAdapter;
    var FirebaseAdapter = firepad.FirebaseAdapter;
    var EditorClient = firepad.EditorClient;
    var EntityManager = firepad.EntityManager;
    var ATTR = firepad.AttributeConstants;
    var utils = firepad.utils;
    var LIST_TYPE = firepad.LineFormatting.LIST_TYPE;
    var CodeMirror = global.CodeMirror;
    var ace = global.ace;

    function Firepad(ref, place, options) {
        if (!(this instanceof Firepad)) {
            return new Firepad(ref, place, options);
        }

        if (!CodeMirror && !ace) {
            throw new Error('Couldn\'t find CodeMirror or ACE.  Did you forget to include codemirror.js or ace.js?');
        }

    this.zombie_ = false;

        if (CodeMirror && place instanceof CodeMirror) {
            this.codeMirror_ = this.editor_ = place;
            var curValue = this.codeMirror_.getValue();
            if (curValue !== '') {
                throw new Error("Can't initialize Firepad with a CodeMirror instance that already contains text.");
            }
        } else if (ace && place && place.session instanceof ace.EditSession) {
            this.ace_ = this.editor_ = place;
            curValue = this.ace_.getValue();
            if (curValue !== '') {
                throw new Error("Can't initialize Firepad with an ACE instance that already contains text.");
            }
        } else {
            this.codeMirror_ = this.editor_ = new CodeMirror(place);
        }

        var editorWrapper = this.codeMirror_ ? this.codeMirror_.getWrapperElement() : this.ace_.container;
        this.firepadWrapper_ = utils.elt("div", null, { 'class': 'firepad' });
        editorWrapper.parentNode.replaceChild(this.firepadWrapper_, editorWrapper);

        this.editorContainer_ = utils.elt("div", null, { 'class': 'firepad-editor-container' });
        this.editorContainer_.appendChild(editorWrapper);
        this.firepadWrapper_.appendChild(this.editorContainer_);

        // Don't allow drag/drop because it causes issues.  See https://github.com/firebase/firepad/issues/36
        utils.on(editorWrapper, 'dragstart', utils.stopEvent);

        // Provide an easy way to get the firepad instance associated with this CodeMirror instance.
        this.editor_.firepad = this;

        this.options_ = options || { };

        if (this.getOption('richTextShortcuts', false)) {
            if (!CodeMirror.keyMap['richtext']) {
                this.initializeKeyMap_();
            }
            this.codeMirror_.setOption('keyMap', 'richtext');
            this.firepadWrapper_.className += ' firepad-richtext';
        }

        this.imageInsertionUI = this.getOption('imageInsertionUI', true);

        if (this.getOption('richTextToolbar', false)) {
            this.toolbarItems = this.getOption('toolbarItems');
            this.addToolbar_();
            this.editorContainer_.className += ' firepad-container-with-toolbar';
            this.firepadWrapper_.className += ' firepad-richtext firepad-with-toolbar';
        }

        this.addPoweredByLogo_();

        // Now that we've mucked with CodeMirror, refresh it.
        if (this.codeMirror_)
            this.codeMirror_.refresh();

    var userId = this.getOption('userId', ref.push().key);
        var userColor = this.getOption('userColor', colorFromUserId(userId));

        this.entityManager_ = new EntityManager();

        this.firebaseAdapter_ = new FirebaseAdapter(ref, userId, userColor);
        if (this.codeMirror_) {
            this.richTextCodeMirror_ = new RichTextCodeMirror(this.codeMirror_, this.entityManager_, { cssPrefix: 'firepad-' });
            this.editorAdapter_ = new RichTextCodeMirrorAdapter(this.richTextCodeMirror_);
        } else {
            this.editorAdapter_ = new ACEAdapter(this.ace_);
        }
        this.client_ = new EditorClient(this.firebaseAdapter_, this.editorAdapter_);

        var self = this;
        this.firebaseAdapter_.on('cursor', function () {
            self.trigger.apply(self, ['cursor'].concat([].slice.call(arguments)));
        });

        if (this.codeMirror_) {
            this.richTextCodeMirror_.on('newLine', function () {
                self.trigger.apply(self, ['newLine'].concat([].slice.call(arguments)));
            });
        }

        this.firebaseAdapter_.on('ready', function () {
            self.ready_ = true;

            if (this.ace_) {
                this.editorAdapter_.grabDocumentState();
            }

            var defaultText = self.getOption('defaultText', null);
            if (defaultText && self.isHistoryEmpty()) {
                self.setText(defaultText);
            }

            self.trigger('ready');
        });

        this.client_.on('synced', function (isSynced) {
            self.trigger('synced', isSynced)
        });

        // Hack for IE8 to make font icons work more reliably.
        // http://stackoverflow.com/questions/9809351/ie8-css-font-face-fonts-only-working-for-before-content-on-over-and-sometimes
        if (navigator.appName == 'Microsoft Internet Explorer' && navigator.userAgent.match(/MSIE 8\./)) {
            window.onload = function () {
                var head = document.getElementsByTagName('head')[0],
                    style = document.createElement('style');
                style.type = 'text/css';
                style.styleSheet.cssText = ':before,:after{content:none !important;}';
                head.appendChild(style);
                setTimeout(function () {
                    head.removeChild(style);
                }, 0);
            };
        }
    }

    utils.makeEventEmitter(Firepad);

    // For readability, these are the primary "constructors", even though right now they're just aliases for Firepad.
    Firepad.fromCodeMirror = Firepad;
    Firepad.fromACE = Firepad;

    Firepad.prototype.dispose = function () {
        this.zombie_ = true; // We've been disposed.  No longer valid to do anything.

        // Unwrap the editor.
        var editorWrapper = this.codeMirror_ ? this.codeMirror_.getWrapperElement() : this.ace_.container;
        this.firepadWrapper_.removeChild(editorWrapper);
        this.firepadWrapper_.parentNode.replaceChild(editorWrapper, this.firepadWrapper_);

        this.editor_.firepad = null;

        if (this.codeMirror_ && this.codeMirror_.getOption('keyMap') === 'richtext') {
            this.codeMirror_.setOption('keyMap', 'default');
        }

        this.firebaseAdapter_.dispose();
        this.editorAdapter_.detach();
        if (this.richTextCodeMirror_)
            this.richTextCodeMirror_.detach();
    };

    Firepad.prototype.setUserId = function (userId) {
        this.firebaseAdapter_.setUserId(userId);
    };

    Firepad.prototype.setUserColor = function (color) {
        this.firebaseAdapter_.setColor(color);
    };

    Firepad.prototype.getText = function () {
        this.assertReady_('getText');
        if (this.codeMirror_)
            return this.richTextCodeMirror_.getText();
        else
            return this.ace_.getSession().getDocument().getValue();
    };

    Firepad.prototype.setText = function (textPieces) {
    this.assertReady_('setText');
        if (this.ace_) {
            return this.ace_.getSession().getDocument().setValue(textPieces);
        } else {
            // HACK: Hide CodeMirror during setText to prevent lots of extra renders.
            this.codeMirror_.getWrapperElement().setAttribute('style', 'display: none');
            this.codeMirror_.setValue("");
            this.insertText(0, textPieces);
            this.codeMirror_.getWrapperElement().setAttribute('style', '');
            this.codeMirror_.refresh();
        }
        this.editorAdapter_.setCursor({position: 0, selectionEnd: 0});
    };

    Firepad.prototype.insertTextAtCursor = function (textPieces) {
        this.insertText(this.codeMirror_.indexFromPos(this.codeMirror_.getCursor()), textPieces);
    };

    Firepad.prototype.insertText = function (index, textPieces) {
        utils.assert(!this.ace_, "Not supported for ace yet.");
        this.assertReady_('insertText');

        // Wrap it in an array if it's not already.
        if (Object.prototype.toString.call(textPieces) !== '[object Array]') {
            textPieces = [textPieces];
        }

    var self = this;
    self.codeMirror_.operation(function() {
      // HACK: We should check if we're actually at the beginning of a line; but checking for index == 0 is sufficient
      // for the setText() case.
      var atNewLine = index === 0;
      var inserts = firepad.textPiecesToInserts(atNewLine, textPieces);

      for (var i = 0; i < inserts.length; i++) {
        var string     = inserts[i].string;
        var attributes = inserts[i].attributes;
        self.richTextCodeMirror_.insertText(index, string, attributes);
        index += string.length;
      }
    });
    };

    Firepad.prototype.getOperationForSpan = function (start, end) {
        var text = this.richTextCodeMirror_.getRange(start, end);
        var spans = this.richTextCodeMirror_.getAttributeSpans(start, end);
        var pos = 0;
        var op = new firepad.TextOperation();
        for (var i = 0; i < spans.length; i++) {
            op.insert(text.substr(pos, spans[i].length), spans[i].attributes);
            pos += spans[i].length;
        }
        return op;
    };

    Firepad.prototype.getHtml = function () {
        return this.getHtmlFromRange(null, null);
    };

  Firepad.prototype.selectionHasAttributes = function() {
    var startPos = this.codeMirror_.getCursor('start'), endPos = this.codeMirror_.getCursor('end');
    var startIndex = this.codeMirror_.indexFromPos(startPos), endIndex = this.codeMirror_.indexFromPos(endPos);
    return this.rangeHasAttributes(startIndex, endIndex);
  };

  Firepad.prototype.rangeHasAttributes = function(start, end) {
    this.assertReady_('rangeHasAttributes');
    var doc = (start != null && end != null) ?
      this.getOperationForSpan(start, end) :
      this.getOperationForSpan(0, this.codeMirror_.getValue().length);

    var op;
    for (var i = 0; i < doc.ops.length; i++) {
      op = doc.ops[i];
      for (var prop in op.attributes) {
        if (!op.attributes.hasOwnProperty(prop)) continue;
        if (prop==ATTR.LINE_SENTINEL) continue;
        for(var validAttr in firepad.AttributeConstants) if (firepad.AttributeConstants[validAttr] === prop) return true; // found one
      }
    }

    return false;
  };


    Firepad.prototype.getHtmlFromSelection = function () {
        var startPos = this.codeMirror_.getCursor('start'), endPos = this.codeMirror_.getCursor('end');
        var startIndex = this.codeMirror_.indexFromPos(startPos), endIndex = this.codeMirror_.indexFromPos(endPos);
        return this.getHtmlFromRange(startIndex, endIndex);
    };

    Firepad.prototype.getHtmlFromRange = function (start, end) {
    this.assertReady_('getHtmlFromRange');
        var doc = (start != null && end != null) ?
            this.getOperationForSpan(start, end) :
            this.getOperationForSpan(0, this.codeMirror_.getValue().length);
        return firepad.SerializeHtml(doc, this.entityManager_);
    };

    Firepad.prototype.insertHtml = function (index, html) {
        var lines = firepad.ParseHtml(html, this.entityManager_, this.codeMirror_);
        this.insertText(index, lines);
    };

    Firepad.prototype.insertHtmlAtCursor = function (html) {
        this.insertHtml(this.codeMirror_.indexFromPos(this.codeMirror_.getCursor()), html);
    };

    Firepad.prototype.setHtml = function (html) {
        var lines = firepad.ParseHtml(html, this.entityManager_, this.codeMirror_);
        this.setText(lines);
    };

    Firepad.prototype.isHistoryEmpty = function () {
        this.assertReady_('isHistoryEmpty');
        return this.firebaseAdapter_.isHistoryEmpty();
    };

    Firepad.prototype.bold = function () {
        this.richTextCodeMirror_.toggleAttribute(ATTR.BOLD);
    };

    Firepad.prototype.italic = function () {
        this.richTextCodeMirror_.toggleAttribute(ATTR.ITALIC);
    };

    Firepad.prototype.langchecker = function () {
        if (window.Ext && window.Invigos) {
            var rightPanel = Ext.ComponentQuery.query('studentrightpanel')[ 0 ];

            rightPanel.fireEvent('showRightPanel', 'LanguageChecker');
            rightPanel.setTitle('');
        }
    };

    Firepad.prototype.underline = function () {
        this.richTextCodeMirror_.toggleAttribute(ATTR.UNDERLINE);
    };

    Firepad.prototype.strike = function () {
        this.richTextCodeMirror_.toggleAttribute(ATTR.STRIKE);
    };

    Firepad.prototype.fontSize = function (size) {
        this.richTextCodeMirror_.setAttribute(ATTR.FONT_SIZE, size);
    };
    Firepad.prototype.qmid = function() {
        this.richTextCodeMirror_.toggleAttribute(ATTR.QUICKMARK_ID);
    };
    Firepad.prototype.qmclass = function() {
        this.richTextCodeMirror_.toggleAttribute(ATTR.QUICKMARK);
    };
    Firepad.prototype.quickmarkToggle = function(id) {
        this.richTextCodeMirror_.setAttribute(ATTR.QUICKMARK, false);
        this.richTextCodeMirror_.setAttribute(ATTR.QUICKMARK_ID + '-' + id, false);
    };
    Firepad.prototype.formatParagraph = function( size ) {
        var cm = this.codeMirror_;
        var selection = cm.listSelections()[ 0 ];

        var head, anchor;
        // since we modifying head and anchor, to omit changing head&anchor by links
        // we need to create new objects to omit changing cursor position
        if ( selection.anchor.line >= selection.head.line ) {
            head = JSON.parse(JSON.stringify(selection.head));
            anchor = JSON.parse(JSON.stringify(selection.anchor));
        } else {
            head = JSON.parse(JSON.stringify(selection.anchor));
            anchor = JSON.parse(JSON.stringify(selection.head));
        }

        // update full lines from start to end
        head.ch = 0;
        anchor.ch = cm.getLine(anchor.line).length;
        var attribute = ATTR.FONT_SIZE, value = size;
        var headPos = cm.indexFromPos(head), anchorPos = cm.indexFromPos(anchor);
        // use updateTextAttributes instead of setAttribute, so we don't need to change & re-set selection
        this.richTextCodeMirror_.updateTextAttributes(headPos, anchorPos, function( attributes ) {
          if ( value === false ) {
            delete attributes[ attribute ];
          } else {
            attributes[ attribute ] = value;
          }
        }, null, true);
        for (var line = head.line; line <= anchor.line; line++) {
          this.richTextCodeMirror_.clearDanglingFontSizeMarksFromLine_(line, value);
        }
        //TODO: it's a hack, should be fixed
        var attributes = {}; attributes[ attribute ] = value;
        this.richTextCodeMirror_.updateCurrentAttributes_(attributes);
    };

    Firepad.prototype.font = function (font) {
        this.richTextCodeMirror_.setAttribute(ATTR.FONT, font);
    };

    Firepad.prototype.color = function (color) {
        this.richTextCodeMirror_.setAttribute(ATTR.COLOR, color);
    };

    Firepad.prototype.highlight = function () {
        this.richTextCodeMirror_.toggleAttribute(ATTR.BACKGROUND_COLOR, 'rgba(255,255,0,.65)');
    };

    Firepad.prototype.align = function (alignment) {
        if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') {
            throw new Error('align() must be passed "left", "center", or "right".');
        }
        this.richTextCodeMirror_.setLineAttribute(ATTR.LINE_ALIGN, alignment);
    };

    Firepad.prototype.orderedList = function () {
        this.richTextCodeMirror_.toggleLineAttribute(ATTR.LIST_TYPE, 'o');
    };

    Firepad.prototype.unorderedList = function () {
        this.richTextCodeMirror_.toggleLineAttribute(ATTR.LIST_TYPE, 'u');
    };

    Firepad.prototype.todo = function () {
        this.richTextCodeMirror_.toggleTodo();
    };

    Firepad.prototype.newline = function () {
        this.richTextCodeMirror_.newline();
    };

    Firepad.prototype.deleteLeft = function () {
        this.richTextCodeMirror_.deleteLeft();
    };

    Firepad.prototype.deleteRight = function () {
        this.richTextCodeMirror_.deleteRight();
    };

    Firepad.prototype.indent = function () {
        this.richTextCodeMirror_.indent();
    };

    Firepad.prototype.unindent = function () {
        this.richTextCodeMirror_.unindent();
    };

    Firepad.prototype.undo = function () {
        this.codeMirror_.undo();
    };

    Firepad.prototype.redo = function () {
        this.codeMirror_.redo();
    };

    Firepad.prototype.insertEntity = function (type, info, origin) {
        this.richTextCodeMirror_.insertEntityAtCursor(type, info, origin);
    };

    Firepad.prototype.insertEntityAt = function (index, type, info, origin) {
        this.richTextCodeMirror_.insertEntityAt(index, type, info, origin);
    };

    Firepad.prototype.registerEntity = function (type, options) {
        this.entityManager_.register(type, options);
    };

    Firepad.prototype.getOption = function (option, def) {
        return (option in this.options_) ? this.options_[option] : def;
    };

    Firepad.prototype.assertReady_ = function (funcName) {
        if (!this.ready_) {
            throw new Error('You must wait for the "ready" event before calling ' + funcName + '.');
        }
        if (this.zombie_) {
      throw new Error('You can\'t use a Firepad after calling dispose()!  [called ' + funcName + ']');
        }
    };

    Firepad.prototype.makeImageDialog_ = function () {
        this.makeDialog_('img', 'Insert image url');
    };

    Firepad.prototype.makeDialog_ = function (id, placeholder) {
        var self = this;

        var hideDialog = function () {
            var dialog = document.getElementById('overlay');
            dialog.style.visibility = "hidden";
            self.firepadWrapper_.removeChild(dialog);
        };

        var cb = function () {
            var dialog = document.getElementById('overlay');
            dialog.style.visibility = "hidden";
            var src = document.getElementById(id).value;
            if (src !== null)
                self.insertEntity(id, { 'src': src });
            self.firepadWrapper_.removeChild(dialog);
        };

        var input = utils.elt('input', null, { 'class': 'firepad-dialog-input', 'id': id, 'type': 'text', 'placeholder': placeholder, 'autofocus': 'autofocus' });

        var submit = utils.elt('a', 'Submit', { 'class': 'firepad-btn', 'id': 'submitbtn' });
        utils.on(submit, 'click', utils.stopEventAnd(cb));

        var cancel = utils.elt('a', 'Cancel', { 'class': 'firepad-btn' });
        utils.on(cancel, 'click', utils.stopEventAnd(hideDialog));

        var buttonsdiv = utils.elt('div', [submit, cancel], { 'class': 'firepad-btn-group' });

        var div = utils.elt('div', [input, buttonsdiv], { 'class': 'firepad-dialog-div' });
        var dialog = utils.elt('div', [div], { 'class': 'firepad-dialog', id: 'overlay' });

        this.firepadWrapper_.appendChild(dialog);
    };

    Firepad.prototype.zoom = function (value) {
        this.codeMirror_.display.wrapper.style.zoom = value;
    };

    Firepad.prototype.cut = function () {
        var doc = this.codeMirror_.doc;
        var selection = this.richTextCodeMirror_.copyHtml(this);
        if (selection) {
            this.copyText = selection;
            doc.replaceSelection('');
        }
    };
    Firepad.prototype.copy = function () {
        var selection = this.richTextCodeMirror_.copyHtml(this);
        if (selection) {
            this.copyText = selection;
        }
    };
    Firepad.prototype.paste = function () {
      var doc = this.codeMirror_.doc;
      doc.replaceSelection('');
      this.insertHtmlAtCursor(this.copyText);
    };

    Firepad.prototype.markQuickmark = function (id) {
        this.richTextCodeMirror_.toggleAttribute(ATTR.QUICKMARK);
        if (id) {
            this.richTextCodeMirror_.toggleAttribute(ATTR.QUICKMARK_ID+'-'+id);
        }
    };

    Firepad.prototype.markText = function (from, to, cls) {
        this.codeMirror_.doc.markText(from, to, { className: cls });
    };

    Firepad.prototype.unmarkText = function () {
        var marks = this.codeMirror_.getAllMarks();
        for (var i = marks.length - 1; i >= 0; i--) {
            if (m(marks[i].className) && (marks[i].className.indexOf('firepad-bc-rgb')) != -1) //found
                marks[i].clear();
        }
    };

    Firepad.prototype.addToolbar_ = function () {
        this.toolbar = new RichTextToolbar(this.imageInsertionUI, this.toolbarItems);

        function toCamelCase( input ) {
            return input.toLowerCase().replace(/-(.)/g, function( match, group1 ) {
                return group1.toUpperCase();
            });
        }

        function returnFocusDecorator( fn ) {
            var args = Array.prototype.slice.call(arguments, 1);
            fn.apply(this, args);
            this.codeMirror_.focus();
        }

        var buttons = [
            { evt: 'zoom',  handler: this.zoom},

            { evt: 'cut',   handler: this.cut },
            { evt: 'copy',  handler: this.copy },
            { evt: 'paste', handler: this.paste },

            { evt: 'format-paragraph', handler: this.formatParagraph },

            { evt: 'undo', handler: this.undo },
            { evt: 'redo', handler: this.redo },

            { evt: 'bold',   handler: this.bold },
            { evt: 'italic', handler: this.italic },

            { evt: 'langchecker', handler: this.langchecker },

            { evt: 'font-size', handler: this.fontSize },
            { evt: 'font',      handler: this.font },
            { evt: 'color',     handler: this.color },

            { evt: 'left',   handler: this.align, args: [ 'left' ] },
            { evt: 'center', handler: this.align, args: [ 'center' ] },
            { evt: 'right',  handler: this.align, args: [ 'right' ] },

            { evt: 'ordered-list',   handler: this.orderedList },
            { evt: 'unordered-list', handler: this.unorderedList },

            { evt: 'todo-list', handler: this.todo },

            { evt: 'indent-increase', handler: this.indent },
            { evt: 'indent-decrease', handler: this.unindent },

            { evt: 'insert-image', handler: this.makeImageDialog_ }
        ];

        buttons.forEach(function( b ) {
            var evt = b.evt;
            var handler = b.handler ? b.handler : toCamelCase(b.evt);
            var args = [ handler ];
            if ( b.args ) args = args.concat(b.args);

            this.toolbar.on(evt, returnFocusDecorator.bind.apply(returnFocusDecorator, [ this ].concat(args)), this);
        }, this);

        this.firepadWrapper_.insertBefore(this.toolbar.element(), this.firepadWrapper_.firstChild);
    };

    Firepad.prototype.addPoweredByLogo_ = function () {
        var poweredBy = utils.elt('a', null, { 'class': 'powered-by-firepad'});
        poweredBy.setAttribute('href', 'http://www.firepad.io/');
        poweredBy.setAttribute('target', '_blank');
        this.firepadWrapper_.appendChild(poweredBy)
    };

    Firepad.prototype.initializeKeyMap_ = function () {
        function binder(fn) {
            return function (cm) {
                // HACK: CodeMirror will often call our key handlers within a cm.operation(), and that
                // can mess us up (we rely on events being triggered synchronously when we make CodeMirror
                // edits).  So to escape any cm.operation(), we do a setTimeout.
                setTimeout(function () {
                    fn.call(cm.firepad);
                }, 0);
            }
        }

        CodeMirror.keyMap["richtext"] = {
            "Ctrl-B": binder(this.bold),
            "Cmd-B": binder(this.bold),
            "Ctrl-I": binder(this.italic),
            "Cmd-I": binder(this.italic),
            "Ctrl-L": binder(this.langchecker),
            "Cmd-L": binder(this.langchecker),
            "Ctrl-U": binder(this.underline),
            "Cmd-U": binder(this.underline),
            "Ctrl-H": binder(this.highlight),
            "Cmd-H": binder(this.highlight),
            "Enter": binder(this.newline),
            "Delete": binder(this.deleteRight),
            "Backspace": binder(this.deleteLeft),
            "Tab": binder(this.indent),
            "Shift-Tab": binder(this.unindent),
            fallthrough: ['default']
        };
    };

    function colorFromUserId(userId) {
        var a = 1;
        for (var i = 0; i < userId.length; i++) {
            a = 17 * (a + userId.charCodeAt(i)) % 360;
        }
        var hue = a / 360;

    return hsl2hex(hue, 1, 0.75);
    }

    function rgb2hex(r, g, b) {
        function digits(n) {
            var m = Math.round(255 * n).toString(16);
            return m.length === 1 ? '0' + m : m;
        }

        return '#' + digits(r) + digits(g) + digits(b);
    }

    function hsl2hex(h, s, l) {
        if (s === 0) {
            return rgb2hex(l, l, l);
        }
        var var2 = l < 0.5 ? l * (1 + s) : (l + s) - (s * l);
        var var1 = 2 * l - var2;
        var hue2rgb = function (hue) {
            if (hue < 0) {
                hue += 1;
            }
            if (hue > 1) {
                hue -= 1;
            }
            if (6 * hue < 1) {
                return var1 + (var2 - var1) * 6 * hue;
            }
            if (2 * hue < 1) {
                return var2;
            }
            if (3 * hue < 2) {
                return var1 + (var2 - var1) * 6 * (2 / 3 - hue);
            }
            return var1;
        };
        return rgb2hex(hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3));
    }

    return Firepad;
})(this);

// Export Text classes
firepad.Firepad.Formatting = firepad.Formatting;
firepad.Firepad.Text = firepad.Text;
firepad.Firepad.Entity = firepad.Entity;
firepad.Firepad.LineFormatting = firepad.LineFormatting;
firepad.Firepad.Line = firepad.Line;
firepad.Firepad.TextOperation = firepad.TextOperation;
firepad.Firepad.Headless = firepad.Headless;

// Export adapters
firepad.Firepad.RichTextCodeMirrorAdapter = firepad.RichTextCodeMirrorAdapter;
firepad.Firepad.ACEAdapter = firepad.ACEAdapter;
