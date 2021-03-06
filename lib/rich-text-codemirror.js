var firepad = firepad || { };

firepad.RichTextCodeMirror = (function () {
  var AnnotationList = firepad.AnnotationList;
  var Span = firepad.Span;
  var utils = firepad.utils;
  var ATTR = firepad.AttributeConstants;
  var RichTextClassPrefixDefault = 'cmrt-';
  var RichTextOriginPrefix = 'cmrt-';

  // These attributes will have styles generated dynamically in the page.
  var DynamicStyleAttributes = {
    'c' : 'color',
    'bc': 'background-color',
    'fs' : 'font-size',
    'li' : function(indent) { return 'padding-left: ' + (indent * 40) + 'px'; }
  };

  // A cache of dynamically-created styles so we can re-use them.
  var StyleCache_ = {};

  function RichTextCodeMirror(codeMirror, entityManager, options) {
    this.codeMirror = codeMirror;
    this.options_ = options || { };
    this.entityManager_ = entityManager;
    this.currentAttributes_ = null;

    var self = this;
    this.annotationList_ = new AnnotationList(
        function(oldNodes, newNodes) { self.onAnnotationsChanged_(oldNodes, newNodes); });

    // Ensure annotationList is in sync with any existing codemirror contents.
    this.initAnnotationList_();

    bind(this, 'onCodeMirrorBeforeChange_');
    bind(this, 'onCodeMirrorChange_');
    bind(this, 'onCursorActivity_');

    bind(this, 'onCodeMirrorCopyCut_');
    bind(this, 'onCodeMirrorPaste_');

    if (parseInt(CodeMirror.version) >= 4) {
      this.codeMirror.on('changes', this.onCodeMirrorChange_);
    } else {
      this.codeMirror.on('change', this.onCodeMirrorChange_);
    }
    this.codeMirror.on('beforeChange', this.onCodeMirrorBeforeChange_);
    this.codeMirror.on('cursorActivity', this.onCursorActivity_);

    this.codeMirror.on('copy', this.onCodeMirrorCopyCut_);
    this.codeMirror.on('cut', this.onCodeMirrorCopyCut_);
    this.codeMirror.on('paste', this.onCodeMirrorPaste_);

    this.changeId_ = 0;
    this.outstandingChanges_ = { };
    this.dirtyLines_ = [];
  }
  utils.makeEventEmitter(RichTextCodeMirror, ['change', 'attributesChange', 'newLine', 'currentAttributesChange']);


  var LineSentinelCharacter   = firepad.sentinelConstants.LINE_SENTINEL_CHARACTER;
  var EntitySentinelCharacter = firepad.sentinelConstants.ENTITY_SENTINEL_CHARACTER;

  RichTextCodeMirror.prototype.detach = function() {
    this.codeMirror.off('beforeChange', this.onCodeMirrorBeforeChange_);
    this.codeMirror.off('change', this.onCodeMirrorChange_);
    this.codeMirror.off('changes', this.onCodeMirrorChange_);
    this.codeMirror.off('cursorActivity', this.onCursorActivity_);

    this.codeMirror.off('copy', this.onCodeMirrorCopyCut_);
    this.codeMirror.off('cut', this.onCodeMirrorCopyCut_);
    this.codeMirror.off('paste', this.onCodeMirrorPaste_);

    this.clearAnnotations_();
  };

  RichTextCodeMirror.prototype.toggleAttribute = function(attribute, value) {
    var trueValue = value || true;
    if (this.emptySelection_()) {
      var attrs = this.getCurrentAttributes_();
      if (attrs[attribute] === trueValue) {
        delete attrs[attribute];
      } else {
        attrs[attribute] = trueValue;
      }
      this.currentAttributes_ = attrs;
    } else {
      // for selection we need to take common attributes of selection, not current attributes
      // since end of cursor may be on position after selection and won't have checked attribute
      // for test select something and then toggle attribute twice

      // get all spans in selection
      // if any of them is missing attribute, we need to add attribute for whole selection
      // if all of them have attribute, only then we need to remove it
      var start = cm.indexFromPos(cm.getCursor('start'));
      var end   = cm.indexFromPos(cm.getCursor('end'));
      var spans = this.getAttributeSpans(start, end);
      var needsAttribute = false;

      spans.forEach(function(span){
          if (!span.attributes[attribute]) {
            needsAttribute = true;
          }
      });

      this.setAttribute(attribute, needsAttribute);
    }
  };
    RichTextCodeMirror.prototype.removeAttribute = function(attribute, value) {
        var trueValue = value || true;
        if (this.emptySelection_()) {
            var attrs = this.getCurrentAttributes_();
            if (attrs[attribute] === trueValue) {
                delete attrs[attribute];
            } else {
                attrs[attribute] = trueValue;
            }
            this.currentAttributes_ = attrs;
        }
    };

  RichTextCodeMirror.prototype.setAttribute = function(attribute, value) {
    var cm = this.codeMirror;
    if (this.emptySelection_()) {
      var attrs = this.getCurrentAttributes_();
      if (value === false) {
        delete attrs[attribute];
      } else {
        attrs[attribute] = value;
      }
      this.currentAttributes_ = attrs;
    } else {
      this.updateTextAttributes(cm.indexFromPos(cm.getCursor('start')), cm.indexFromPos(cm.getCursor('end')),
        function(attributes) {
          if (value === false) {
            delete attributes[attribute];
          } else {
            attributes[attribute] = value;
          }
        });
      this.updateCurrentAttributes_();
    }
  };

  RichTextCodeMirror.prototype.updateTextAttributes = function(start, end, updateFn, origin, doLineAttributes) {
    var newChanges = [];
    var pos = start, self = this;
    this.annotationList_.updateSpan(new Span(start, end - start), function(annotation, length) {
      var attributes = { };
      for(var attr in annotation.attributes) {
        attributes[attr] = annotation.attributes[attr];
      }

      // Don't modify if this is a line sentinel.
      if (!attributes[ATTR.LINE_SENTINEL] || doLineAttributes)
        updateFn(attributes);

      // changedAttributes will be the attributes we changed, with their new values.
      // changedAttributesInverse will be the attributes we changed, with their old values.
      var changedAttributes = { }, changedAttributesInverse = { };
      self.computeChangedAttributes_(annotation.attributes, attributes, changedAttributes, changedAttributesInverse);
      if (!emptyAttributes(changedAttributes)) {
        newChanges.push({ start: pos, end: pos + length, attributes: changedAttributes, attributesInverse: changedAttributesInverse, origin: origin });
      }

      pos += length;
      return new RichTextAnnotation(attributes);
    });

    if (newChanges.length > 0) {
      this.trigger('attributesChange', this, newChanges);
    }
  };

  RichTextCodeMirror.prototype.computeChangedAttributes_ = function(oldAttrs, newAttrs, changed, inverseChanged) {
    var attrs = { }, attr;
    for(attr in oldAttrs) { attrs[attr] = true; }
    for(attr in newAttrs) { attrs[attr] = true; }

    for (attr in attrs) {
      if (!(attr in newAttrs)) {
        // it was removed.
        changed[attr] = false;
        inverseChanged[attr] = oldAttrs[attr];
      } else if (!(attr in oldAttrs)) {
        // it was added.
        changed[attr] = newAttrs[attr];
        inverseChanged[attr] = false;
      } else if (oldAttrs[attr] !== newAttrs[attr]) {
        // it was changed.
        changed[attr] = newAttrs[attr];
        inverseChanged[attr] = oldAttrs[attr];
      }
    }
  };

  RichTextCodeMirror.prototype.toggleLineAttribute = function(attribute, value) {
    var currentAttributes = this.getCurrentLineAttributes_();
    var newValue;
    if (!(attribute in currentAttributes) || currentAttributes[attribute] !== value) {
      newValue = value;
    } else {
      newValue = false;
    }
    this.setLineAttribute(attribute, newValue);
  };

  RichTextCodeMirror.prototype.setLineAttribute = function(attribute, value) {
    this.updateLineAttributesForSelection(function(attributes) {
      if (value === false) {
        delete attributes[attribute];
      } else {
        attributes[attribute] = value;
      }
    });
  };

  RichTextCodeMirror.prototype.updateLineAttributesForSelection = function(updateFn) {
    var cm = this.codeMirror;
    var start = cm.getCursor('start'), end = cm.getCursor('end');
    var startLine = start.line, endLine = end.line;
    var endLineText = cm.getLine(endLine);
    var endsAtBeginningOfLine = this.areLineSentinelCharacters_(endLineText.substr(0, end.ch));
    if (endLine > startLine && endsAtBeginningOfLine) {
      // If the selection ends at the beginning of a line, don't include that line.
      endLine--;
    }

    this.updateLineAttributes(startLine, endLine, updateFn);
  };

  RichTextCodeMirror.prototype.updateLineAttributes = function(startLine, endLine, updateFn) {
    // TODO: Batch this into a single operation somehow.
    for(var line = startLine; line <= endLine; line++) {
      var text = this.codeMirror.getLine(line);
      var lineStartIndex = this.codeMirror.indexFromPos({line: line, ch: 0});
      // Create line sentinel character if necessary.
      if (text[0] !== LineSentinelCharacter) {
        var attributes = { };
        attributes[ATTR.LINE_SENTINEL] = true;
        updateFn(attributes);
        this.insertText(lineStartIndex, LineSentinelCharacter, attributes);
      } else {
        this.updateTextAttributes(lineStartIndex, lineStartIndex + 1, updateFn, /*origin=*/null, /*doLineAttributes=*/true);
      }
    }
  };

  RichTextCodeMirror.prototype.replaceText = function(start, end, text, attributes, origin) {
    //var rnd = Math.ceil(Math.random()*1000);
    //console.info('replaceText', arguments); //console.trace();
    //console.group('replaceText'+rnd)
    this.changeId_++;
    var newOrigin = RichTextOriginPrefix + this.changeId_;
    this.outstandingChanges_[newOrigin] = { origOrigin: origin, attributes: attributes };

    var cm = this.codeMirror;
    var from = cm.posFromIndex(start);
    var to = typeof end === 'number' ? cm.posFromIndex(end) : null;
    cm.replaceRange(text, from, to, newOrigin);
    //console.groupEnd('replaceText'+rnd);
  };

  RichTextCodeMirror.prototype.insertText = function(index, text, attributes, origin) {
    //var rnd = Math.ceil(Math.random()*1000);
    //console.info('insertText', arguments); //console.trace();
    //console.group('insertText'+rnd)
    var cm = this.codeMirror;
    var cursor = cm.getCursor();
    var resetCursor = origin == 'RTCMADAPTER' && !cm.somethingSelected() && index == cm.indexFromPos(cursor);
    this.replaceText(index, null, text, attributes, origin);
    if (resetCursor) cm.setCursor(cursor);
    //console.groupEnd('insertText'+rnd);
  };

  RichTextCodeMirror.prototype.removeText = function(start, end, origin) {
    //var rnd = Math.ceil(Math.random()*1000);
    //console.info('removeText', arguments); //console.trace();
    //console.group('removeText'+rnd)
    var cm = this.codeMirror;
    cm.replaceRange("", cm.posFromIndex(start), cm.posFromIndex(end), origin);
    //console.groupEnd('removeText'+rnd);
  };

  RichTextCodeMirror.prototype.insertEntityAtCursor = function(type, info, origin) {
    var cm = this.codeMirror;
    var index = cm.indexFromPos(cm.getCursor('head'));
    this.insertEntityAt(index, type, info, origin);
  };

  RichTextCodeMirror.prototype.insertEntityAt = function(index, type, info, origin) {
    var cm = this.codeMirror;
    this.insertEntity_(index, new firepad.Entity(type, info), origin);
  };

  RichTextCodeMirror.prototype.insertEntity_ = function(index, entity, origin) {
    this.replaceText(index, null, EntitySentinelCharacter, entity.toAttributes(), origin);
  };

  RichTextCodeMirror.prototype.getAttributeSpans = function(start, end) {
    var spans = [];
    var annotatedSpans = this.annotationList_.getAnnotatedSpansForSpan(new Span(start, end - start));
    for(var i  = 0; i < annotatedSpans.length; i++) {
      spans.push({ length: annotatedSpans[i].length, attributes: annotatedSpans[i].annotation.attributes });
    }

    return spans;
  };

  RichTextCodeMirror.prototype.end = function() {
    var lastLine = this.codeMirror.lineCount() - 1;
    return this.codeMirror.indexFromPos({line: lastLine, ch: this.codeMirror.getLine(lastLine).length});
  };

  RichTextCodeMirror.prototype.getRange = function(start, end) {
    var from = this.codeMirror.posFromIndex(start), to = this.codeMirror.posFromIndex(end);
    return this.codeMirror.getRange(from, to);
  };

  RichTextCodeMirror.prototype.initAnnotationList_ = function() {
    // Insert empty annotation span for existing content.
    var end = this.end();
    if (end !== 0) {
      this.annotationList_.insertAnnotatedSpan(new Span(0, end), new RichTextAnnotation());
    }
  };

  /**
   * Updates the nodes of an Annotation.
   * @param {Array.<OldAnnotatedSpan>} oldNodes The list of nodes to replace.
   * @param {Array.<NewAnnotatedSpan>} newNodes The new list of nodes.
   */
  RichTextCodeMirror.prototype.onAnnotationsChanged_ = function(oldNodes, newNodes) {
    var marker;
    //var rnd = Math.ceil(Math.random()*1000);
    //console.group('onAnnotationsChanged'+rnd);
    //console.info('onAnnotationsChanged_', oldNodes, newNodes); //console.trace();

    var linesToReMark = { };

    // Update any entities in-place that we can.  This will remove them from the oldNodes/newNodes lists
    // so we don't remove and recreate them below.
    this.tryToUpdateEntitiesInPlace(oldNodes, newNodes);

    for(var i = 0; i < oldNodes.length; i++) {
      var attributes = oldNodes[i].annotation.attributes;
      if (ATTR.LINE_SENTINEL in attributes) {
        linesToReMark[this.codeMirror.posFromIndex(oldNodes[i].pos).line] = true;
      }
      marker = oldNodes[i].getAttachedObject();
      if (marker) {
        marker.clear();
      }
    }

    for (i = 0; i < newNodes.length; i++) {
      var annotation = newNodes[i].annotation;
      var forLine = (ATTR.LINE_SENTINEL in annotation.attributes);
      var entity = (ATTR.ENTITY_SENTINEL in annotation.attributes);

      var from = this.codeMirror.posFromIndex(newNodes[i].pos);
      if (forLine) {
        linesToReMark[from.line] = true;
      } else if (entity) {
        this.markEntity_(newNodes[i]);
      } else {
        var className = this.getClassNameForAttributes_(annotation.attributes);
        //console.log(className)
        //if (className.match(/firepad-fs-30px/)) debugger;
        if (className !== '') {
          var to = this.codeMirror.posFromIndex(newNodes[i].pos + newNodes[i].length);
          marker = this.codeMirror.markText(from, to, { className: className });
          newNodes[i].attachObject(marker);
        }
      }
    }

    for ( var line in linesToReMark ) {
      var lineHandle = this.codeMirror.getLineHandle(Number(line));
      this.dirtyLines_.push(lineHandle);
      this.queueLineMarking_();
    }

    //console.info('linesToReMark', linesToReMark);
    var newNodesParagraphsCount = newNodes.reduce(function( acc, annotatedSpan ) {
      return acc + (annotatedSpan.annotation.attributes[ ATTR.LINE_SENTINEL ] ? 1 : 0)
    }, 0);
    var oldNodesParagraphsCount = oldNodes.reduce(function( acc, annotatedSpan ) {
      return acc + (annotatedSpan.annotation.attributes[ ATTR.LINE_SENTINEL ] ? 1 : 0)
    }, 0);
    if (
      //if we modifying text
      oldNodes.length
      //and we concatenating text in some way into single line
      && (newNodesParagraphsCount == 0 && oldNodesParagraphsCount > 0)
    ) {
      //since we doing it only for first line (that is concatenated in some way), it is right to set current styles to that line
      this.updateCurrentAttributesFromLineAttributes_();
      var line = this.codeMirror.getCursor().line;
      //console.log('%cmerging annotations', 'color: green');
      //get first current line font-size and apply it to the end of the line
      var from = this.codeMirror.indexFromPos({ line: line, ch: 0 });
      var to = this.codeMirror.indexFromPos({ line: line, ch: this.codeMirror.getLine(line).length + 1 });
      //ch is 0 because prev 0 sentinel has prev line styles
      var mark = this.codeMirror.findMarksAt({line: line, ch: 1}).reduce(function(acc, mark){
        if (mark.isForLineSentinel) return acc; else return mark;
      }, null);
      if (!mark) {
        //if text present and mark is missing because we have standard text without marks, fake mark
        if (this.codeMirror.getLineHandle(line).text) {
          mark = { className: 'firepad-fs-14px' }
        }
        //if mark missing for some other reason, skip it
        else return;
      }
      var attributes = this.getAttributesForClassName_(mark.className);
      setTimeout(function(line, from, to, attributes) {
        var attribute = ATTR.FONT_SIZE, value = attributes[ ATTR.FONT_SIZE ];
        //console.log('updateTextAttributes', from, to, value)
        this.updateTextAttributes(from, to, function( attributes ) {
          if ( value === false ) {
            delete attributes[ attribute ];
          } else {
            attributes[ attribute ] = value;
          }
        });
        //now iterate trough all styles and clear any that don't fit (left from previous lines with different styles)
        this.clearDanglingFontSizeMarksFromLine_(line, value);
      }.bind(this, line, from, to, attributes), 0)
    }
    //console.groupEnd('onAnnotationsChanged' + rnd);
  };

  RichTextCodeMirror.prototype.clearDanglingFontSizeMarksFromLine_ = function(line, fsValue) {
    var className;
    if (fsValue) {
      var attributes = {};
      attributes[ATTR.FONT_SIZE] = fsValue;
      className = this.getClassNameForAttributes_(attributes);
    }
    if (cm.getLineHandle(line).text === LineSentinelCharacter) {
        cm.getLineHandle(line).textClass = '';
    }
    this.codeMirror.findMarksAt({
        line: line,
        ch: (this.codeMirror.getLine(line) || "").length + 1
    }).forEach(function(mark){
      if (mark.isForLineSentinel || !mark.className) {
        return;
      }
      if (!className || !mark.className.match(className)) mark.clear();
    });
  };

  RichTextCodeMirror.prototype.tryToUpdateEntitiesInPlace = function(oldNodes, newNodes) {
    // Loop over nodes in reverse order so we can easily splice them out as necessary.
    var oldNodesLen = oldNodes.length;
    while (oldNodesLen--) {
      var oldNode = oldNodes[oldNodesLen];
      var newNodesLen = newNodes.length;
      while (newNodesLen--) {
        var newNode = newNodes[newNodesLen];
        if (oldNode.pos == newNode.pos &&
            oldNode.length == newNode.length &&
            oldNode.annotation.attributes['ent'] &&
            oldNode.annotation.attributes['ent'] == newNode.annotation.attributes['ent']) {
          var entityType = newNode.annotation.attributes['ent'];
          if (this.entityManager_.entitySupportsUpdate(entityType)) {
            // Update it in place and remove the change from oldNodes / newNodes so we don't process it below.
            oldNodes.splice(oldNodesLen, 1);
            newNodes.splice(newNodesLen, 1);
            var marker = oldNode.getAttachedObject();
            marker.update(newNode.annotation.attributes);
            newNode.attachObject(marker);
          }
        }
      }
    }
  };

  RichTextCodeMirror.prototype.queueLineMarking_ = function() {
    if (this.lineMarkTimeout_ != null) return;
    var self = this;

    this.lineMarkTimeout_ = setTimeout(function() {
      self.lineMarkTimeout_ = null;
      var dirtyLineNumbers = [];
      for(var i = 0; i < self.dirtyLines_.length; i++) {
        var lineNum = self.codeMirror.getLineNumber(self.dirtyLines_[i]);
        dirtyLineNumbers.push(Number(lineNum));
      }
      self.dirtyLines_ = [];

      dirtyLineNumbers.sort(function(a, b) { return a - b; });
      var lastLineMarked = -1;
      for(i = 0; i < dirtyLineNumbers.length; i++) {
        var lineNumber = dirtyLineNumbers[i];
        if (lineNumber > lastLineMarked) {
          lastLineMarked = self.markLineSentinelCharactersForChangedLines_(lineNumber, lineNumber);
        }
      }
    }, 0);
  };

  RichTextCodeMirror.prototype.addStyleWithCSS_ = function(css) {
    var head = document.getElementsByTagName('head')[0],
        style = document.createElement('style');

    style.type = 'text/css';
    if (style.styleSheet){
      style.styleSheet.cssText = css;
    } else {
      style.appendChild(document.createTextNode(css));
    }

    head.appendChild(style);
  };

  //limited version which only supports font-size
  RichTextCodeMirror.prototype.getAttributesForClassName_ = function(className) {
    var match = className && className.match('firepad-'+ATTR.FONT_SIZE+'-'+'(\d*(?:\.\d*)*px)');
    var attr = {};
    if (match && match[1]) {
      attr[ATTR.FONT_SIZE] = match[1];
    }
    return attr;
  };

  RichTextCodeMirror.prototype.getClassNameForAttributes_ = function(attributes) {
    var globalClassName = '';
    for (var attr in attributes) {
      var val = attributes[attr];
      if (attr === ATTR.LINE_SENTINEL) {
        firepad.utils.assert(val === true, "LINE_SENTINEL attribute should be true if it exists.");
      } else {
        var className = (this.options_['cssPrefix'] || RichTextClassPrefixDefault) + attr;
        if (val !== true) {
          // Append "px" to font size if it's missing.
          // Probably could be removed now as parseHtml automatically adds px when required
          if (attr === ATTR.FONT_SIZE && typeof val !== "string") {
            val = val + "px";
          }

          var classVal = val.toString().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
          className += '-' + classVal;
          if (DynamicStyleAttributes[attr]) {
            if (!StyleCache_[attr]) StyleCache_[attr] = {};
            if (!StyleCache_[attr][classVal]) {
              StyleCache_[attr][classVal] = true;
              var dynStyle = DynamicStyleAttributes[attr];
              var css = (typeof dynStyle === 'function') ?
                  dynStyle(val) :
                  dynStyle + ": " + val;

              var selector = (attr == ATTR.LINE_INDENT) ?
                  'pre.' + className :
                  '.' + className;

              this.addStyleWithCSS_(selector + ' { ' + css + ' }');
            }
          }
        }
        globalClassName = globalClassName + ' ' + className;
      }
    }
    return globalClassName;
  };

  RichTextCodeMirror.prototype.markEntity_ = function(annotationNode) {
    var attributes = annotationNode.annotation.attributes;
    var entity = firepad.Entity.fromAttributes(attributes);
    var cm = this.codeMirror;
    var self = this;

    var markers = [];
    for(var i = 0; i < annotationNode.length; i++) {
      var from = cm.posFromIndex(annotationNode.pos + i);
      var to = cm.posFromIndex(annotationNode.pos + i + 1);

      var options = { collapsed: true, atomic: true, inclusiveLeft: false, inclusiveRight: false };

      var entityHandle = this.createEntityHandle_(entity, annotationNode.pos);

      var element = this.entityManager_.renderToElement(entity, entityHandle);
      if (element) {
        options.replacedWith = element;
      }
      var marker = cm.markText(from, to, options);
      markers.push(marker);
      entityHandle.setMarker(marker);
    }

    annotationNode.attachObject({
      clear: function() {
        for(var i = 0; i < markers.length; i++) {
          markers[i].clear();
        }
      },

      /**
       * Updates the attributes of all the AnnotationNode entities.
       * @param {Object.<string, string>} info The full list of new
       *     attributes to apply.
       */
      update: function(info) {
        var entity = firepad.Entity.fromAttributes(info);
        for(var i = 0; i < markers.length; i++) {
          self.entityManager_.updateElement(entity, markers[i].replacedWith);
        }
      }
    });

    // This probably shouldn't be necessary.  There must be a lurking CodeMirror bug.
    this.queueRefresh_();
  };

  RichTextCodeMirror.prototype.queueRefresh_ = function() {
    var self = this;
    if (!this.refreshTimer_) {
      this.refreshTimer_ = setTimeout(function() {
        self.codeMirror.refresh();
        self.refreshTimer_ = null;
      }, 0);
    }
  };

  RichTextCodeMirror.prototype.createEntityHandle_ = function(entity, location) {
    var marker = null;
    var self = this;

    function find() {
      if (marker) {
        var where = marker.find();
        return where ? self.codeMirror.indexFromPos(where.from) : null;
      } else {
        return location;
      }
    }

    function remove() {
      var at = find();
      if (at != null) {
        self.codeMirror.focus();
        self.removeText(at, at + 1);
      }
    }

    /**
     * Updates the attributes of an Entity.  Will call .update() if the entity supports it,
     * else it'll just remove / re-create the entity.
     * @param {Object.<string, string>} info The full list of new
     *     attributes to apply.
     */
    function replace(info) {
      var ATTR = firepad.AttributeConstants;
      var SENTINEL = ATTR.ENTITY_SENTINEL;
      var PREFIX = SENTINEL + '_';

      var at = find();

      self.updateTextAttributes(at, at+1, function(attrs) {
        for (var member in attrs) {
          delete attrs[member];
        }
        attrs[SENTINEL] = entity.type;

        for(var attr in info) {
          attrs[PREFIX + attr] = info[attr];
        }
      });
    }

    function setMarker(m) {
      marker = m;
    }

    return { find: find, remove: remove, replace: replace,
             setMarker: setMarker };
  };

  RichTextCodeMirror.prototype.lineClassRemover_ = function(lineNum) {
    var cm = this.codeMirror;
    var lineHandle = cm.getLineHandle(lineNum);
    return {
      clear: function() {
        // HACK to remove all classes (since CodeMirror treats this as a regex internally).
        cm.removeLineClass(lineHandle, "text", ".*");
      }
    }
  };

  RichTextCodeMirror.prototype.emptySelection_ = function() {
    var start = this.codeMirror.getCursor('start'), end = this.codeMirror.getCursor('end');
    return (start.line === end.line && start.ch === end.ch);
  };

  RichTextCodeMirror.prototype.onCodeMirrorBeforeChange_ = function(cm, change) {
    // Remove LineSentinelCharacters from incoming input (e.g copy/pasting)
    if (change.origin === '+input' || change.origin === 'paste') {
      var newText = [];
      for(var i = 0; i < change.text.length; i++) {
        var t = change.text[i];
        t = t.replace(new RegExp('[' + LineSentinelCharacter + EntitySentinelCharacter + ']', 'g'), '');
        newText.push(t);
      }
      change.update(change.from, change.to, newText);
    }
  };

  RichTextCodeMirror.prototype.copyHtml = function(fp) {
    // one time caching of html styles
    if ( !this.firepadStyleWrapper ) {
      var style = window.getComputedStyle(this.codeMirror.getWrapperElement());
      this.firepadStyleWrapper =
          'font-family:'      + style.getPropertyValue('font-family') + ';' +
          'font-size:'        + style.getPropertyValue('font-size') + ';' +
          'background-color:' + style.getPropertyValue('background-color') + ';' +
          'color:'            + style.getPropertyValue('color') + ';' +
          'text-align:'       + style.getPropertyValue('text-align') + ';';
    }

    var val = '';

    // if selection has attributes try to get html
    //if ( fp.selectionHasAttributes() ) {
      val = fp.getHtmlFromSelection();
      if ( val ) {
        val = '<span style="' + this.firepadStyleWrapper + '">' + val + '</span>';
      }
    //}

    return val;
  };

  RichTextCodeMirror.prototype.onCodeMirrorCopyCut_ = function( cm, e ) {
    var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
    var isIE11 = !!window.MSInputMethodContext && !!document.documentMode;
    if ( !e.clipboardData || ios ) return; // clipboard ops not supported

    var fp = this.codeMirror.firepad,
        htmlVal = this.copyHtml(fp),
        plainVal = this.codeMirror.getSelections().join('\n').replace(new RegExp('[' + LineSentinelCharacter + EntitySentinelCharacter + ']', 'g'), '');

    // if we couldn't get html try to get text
    if (!htmlVal) {
      // remove sentinels
      htmlVal = plainVal;
      // no html or text - something went wrong
      if ( !htmlVal ) return;
    }

    if ( e.type == 'cut' ) cm.replaceSelection('', null, 'cut');
    e.clipboardData.clearData();
    //set both text/html and text
    e.clipboardData.setData('text/plain', plainVal);
    e.clipboardData.setData('text/html', htmlVal);
    //IE11 supports only text type
    if (isIE11) {
        e.clipboardData.setData('text', htmlVal);
    }
    fp.copyText = fp.lastCopyText = htmlVal;
    e.preventDefault();
  };

  RichTextCodeMirror.prototype.onCodeMirrorPaste_ = function( cm, e ) {
    var fp = this.codeMirror.firepad;
    var isIE11 = !!window.MSInputMethodContext && !!document.documentMode;
    var htmlVal, plainVal;

    if (e.clipboardData) {
      htmlVal = e.clipboardData.getData('text/html');
      plainVal = e.clipboardData.getData('text')
    }
    // chrome adding meta tag for html content
    htmlVal = htmlVal.replace(/^<meta[^>]*>/,'');
    // since we using insertHtml, convert text to html
    plainVal = plainVal.replace(/\n/,'<br>')
    // if clipboard contain text different from the one copied with button, it may mean two things:
    // 1) button was used to copy new text (clipboard is unable to update)
    //    html == lastCopyText, html != copyText
    //    = paste copyText instead of html
    // 2) text was copied somewhere else (other tab/window/app/etc and onCodeMirrorCopyCut_ wasn't called)
    //    html != lastCopyText, html != copyText
    //    = paste html instead of copyText, update copyText
    if ( htmlVal != fp.copyText ) {
      if ( htmlVal == fp.lastCopyText ) {
        htmlVal = fp.copyText;
      } else {
        fp.copyText = htmlVal;
      }
    }
    if ( !htmlVal && !plainVal ) return; // not html or something went wrong, revert to CM paste

    cm.replaceSelection('');
    var fp = this.codeMirror.firepad;
    fp.insertHtmlAtCursor(htmlVal || plainVal);
    e.preventDefault();
  };

  function cmpPos (a, b) {
    return (a.line - b.line) || (a.ch - b.ch);
  }
  function posEq (a, b) { return cmpPos(a, b) === 0; }
  function posLe (a, b) { return cmpPos(a, b) <= 0; }

  function last (arr) { return arr[arr.length - 1]; }

  function sumLengths (strArr) {
    if (strArr.length === 0) { return 0; }
    var sum = 0;
    for (var i = 0; i < strArr.length; i++) { sum += strArr[i].length; }
    return sum + strArr.length - 1;
  }

  RichTextCodeMirror.prototype.onCodeMirrorChange_ = function(cm, cmChanges) {
    // Handle single change objects and linked lists of change objects.
    if (typeof cmChanges.from === 'object') {
      var changeArray = [];
      while (cmChanges) {
        changeArray.push(cmChanges);
        cmChanges = cmChanges.next;
      }
      cmChanges = changeArray;
    }

    var changes = this.convertCoordinateSystemForChanges_(cmChanges);
    var newChanges = [];

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var start = change.start, end = change.end, text = change.text, removed = change.removed, origin = change.origin;

      // When text with multiple sets of attributes on it is removed, we need to split it into separate remove changes.
      if (removed.length > 0) {
        var oldAnnotationSpans = this.annotationList_.getAnnotatedSpansForSpan(new Span(start, removed.length));
        var removedPos = 0;
        for(var j = 0; j < oldAnnotationSpans.length; j++) {
          var span = oldAnnotationSpans[j];
          newChanges.push({ start: start, end: start + span.length, removedAttributes: span.annotation.attributes,
            removed: removed.substr(removedPos, span.length), attributes: { }, text: "", origin: change.origin });
          removedPos += span.length;
        }

        this.annotationList_.removeSpan(new Span(start, removed.length));
      }

      if (text.length > 0) {
        var attributes;
        // TODO: Handle 'paste' differently?
        if (change.origin === '+input' && change.text == '\n'){
          attributes = { };
        } else if (change.origin === '+input' || change.origin === 'paste') {
          attributes = this.currentAttributes_ || { };
        } else if (this.replaceMode) {
          // attributes = this.currentAttributes_ || { };
          var mark = this.codeMirror.findMarksAt(cm.posFromIndex(change.start)).reduce(function(acc, mark){
              if (mark.isForLineSentinel) return acc; else return mark;
          }, null);
          attributes = mark && mark.className ? this.getAttributesForClassName_(mark.className) : {};
        } else if (origin in this.outstandingChanges_) {
          attributes = this.outstandingChanges_[origin].attributes;
          origin = this.outstandingChanges_[origin].origOrigin;
          delete this.outstandingChanges_[origin];
        } else {
          attributes = {};
        }

        this.annotationList_.insertAnnotatedSpan(new Span(start, text.length), new RichTextAnnotation(attributes));

        newChanges.push({ start: start, end: start, removedAttributes: { }, removed: "", text: text,
          attributes: attributes, origin: origin });
      }
    }

    this.markLineSentinelCharactersForChanges_(cmChanges);

    if (newChanges.length > 0) {
      this.trigger('change', this, newChanges);
    }
  };

  RichTextCodeMirror.prototype.convertCoordinateSystemForChanges_ = function(changes) {
    // We have to convert the positions in the pre-change coordinate system to indexes.
    // CodeMirror's `indexFromPos` method does this for the current state of the editor.
    // We can use the information of a single change object to convert a post-change
    // coordinate system to a pre-change coordinate system. We can now proceed inductively
    // to get a pre-change coordinate system for all changes in the linked list.  A
    // disadvantage of this approach is its complexity `O(n^2)` in the length of the
    // linked list of changes.

    var self = this;
    var indexFromPos = function (pos) {
      return self.codeMirror.indexFromPos(pos);
    };

    function updateIndexFromPos (indexFromPos, change) {
      return function (pos) {
        if (posLe(pos, change.from)) { return indexFromPos(pos); }
        if (posLe(change.to, pos)) {
          return indexFromPos({
            line: pos.line + change.text.length - 1 - (change.to.line - change.from.line),
            ch: (change.to.line < pos.line) ?
                pos.ch :
                (change.text.length <= 1) ?
                    pos.ch - (change.to.ch - change.from.ch) + sumLengths(change.text) :
                    pos.ch - change.to.ch + last(change.text).length
          }) + sumLengths(change.removed) - sumLengths(change.text);
        }
        if (change.from.line === pos.line) {
          return indexFromPos(change.from) + pos.ch - change.from.ch;
        }
        return indexFromPos(change.from) +
            sumLengths(change.removed.slice(0, pos.line - change.from.line)) +
            1 + pos.ch;
      };
    }

    var newChanges = [];
    for (var i = changes.length - 1; i >= 0; i--) {
      var change = changes[i];
      indexFromPos = updateIndexFromPos(indexFromPos, change);

      var start = indexFromPos(change.from);

      var removedText = change.removed.join('\n');
      var text = change.text.join('\n');
      newChanges.unshift({ start: start, end: start + removedText.length, removed: removedText, text: text,
        origin: change.origin});
    }
    return newChanges;
  };

  /**
   * Detects whether any line sentinel characters were added or removed by the change and if so,
   * re-marks line sentinel characters on the affected range of lines.
   * @param changes
   * @private
   */
  RichTextCodeMirror.prototype.markLineSentinelCharactersForChanges_ = function(changes) {
    // TODO: This doesn't handle multiple changes correctly (overlapping, out-of-oder, etc.).
    // But In practice, people using firepad for rich-text editing don't batch multiple changes
    // together, so this isn't quite as bad as it seems.
    var startLine = Number.MAX_VALUE, endLine = -1;

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var line = change.from.line, ch = change.from.ch;

      if (change.removed.length > 1 || change.removed[0].indexOf(LineSentinelCharacter) >= 0) {
        // We removed 1+ newlines or line sentinel characters.
        startLine = Math.min(startLine, line);
        endLine = Math.max(endLine, line);
      }

      if (change.text.length > 1) { // 1+ newlines
        startLine = Math.min(startLine, line);
        endLine = Math.max(endLine, line + change.text.length - 1);
      } else if (change.text[0].indexOf(LineSentinelCharacter) >= 0) {
        startLine = Math.min(startLine, line);
        endLine = Math.max(endLine, line);
      }
    }

    // HACK: Because the above code doesn't handle multiple changes correctly, endLine might be invalid.  To
    // avoid crashing, we just cap it at the line count.
    endLine = Math.min(endLine, this.codeMirror.lineCount() - 1);

    this.markLineSentinelCharactersForChangedLines_(startLine, endLine);
  };

  RichTextCodeMirror.prototype.markLineSentinelCharactersForChangedLines_ = function(startLine, endLine) {
    // Back up to first list item.
    if (startLine < Number.MAX_VALUE) {
      while(startLine > 0 && this.lineIsListItemOrIndented_(startLine-1)) {
        startLine--;
      }
    }

    // Advance to last list item.
    if (endLine > -1) {
      var lineCount = this.codeMirror.lineCount();
      while (endLine + 1 < lineCount && this.lineIsListItemOrIndented_(endLine+1)) {
        endLine++;
      }
    }

    // keeps track of the list number at each indent level.
    var listNumber = [];

    var cm = this.codeMirror;
    for(var line = startLine; line <= endLine; line++) {
      var text = cm.getLine(line);

      // Remove any existing line classes.
      var lineHandle = cm.getLineHandle(line);
      cm.removeLineClass(lineHandle, "text", ".*");

      if (text.length > 0) {
        var markIndex = text.indexOf(LineSentinelCharacter);
        while (markIndex >= 0) {
          var markStartIndex = markIndex;

          // Find the end of this series of sentinel characters, and remove any existing markers.
          while (markIndex < text.length && text[markIndex] === LineSentinelCharacter) {
            var marks = cm.findMarksAt({ line: line, ch: markIndex });
            for(var i = 0; i < marks.length; i++) {
              if (marks[i].isForLineSentinel) {
                marks[i].clear();
              }
            }

            markIndex++;
          }

          this.markLineSentinelCharacters_(line, markStartIndex, markIndex, listNumber);
          markIndex = text.indexOf(LineSentinelCharacter, markIndex);
        }
      } else {
        // Reset all indents.
        listNumber = [];
      }
    }
    return endLine;
  };

  RichTextCodeMirror.prototype.markLineSentinelCharacters_ = function(line, startIndex, endIndex, listNumber) {
    var cm = this.codeMirror;
    // If the mark is at the beginning of the line and it represents a list element, we need to replace it with
    // the appropriate html element for the list heading.
    var element = null;
    var marker = null;
    var getMarkerLine = function() {
      var span = marker.find();
      return span ? span.from.line : null;
    };

    if (startIndex === 0) {
      var attributes = this.getLineAttributes_(line);
      var listType = attributes[ATTR.LIST_TYPE];
      var indent = attributes[ATTR.LINE_INDENT] || 0;
      if (listType && indent === 0) { indent = 1; }
      while (indent >= listNumber.length) {
        listNumber.push(1);
      }
      if (listType === 'o') {
        element = this.makeOrderedListElement_(listNumber[indent]);
        listNumber[indent]++;
      } else if (listType === 'u') {
        element = this.makeUnorderedListElement_();
        listNumber[indent] = 1;
      } else if (listType === 't') {
        element = this.makeTodoListElement_(false, getMarkerLine);
        listNumber[indent] = 1;
      } else if (listType === 'tc') {
        element = this.makeTodoListElement_(true, getMarkerLine);
        listNumber[indent] = 1;
      }

      var className = this.getClassNameForAttributes_(attributes);
      if (className !== '') {
        this.codeMirror.addLineClass(line, "text", className);
      }

      // Reset deeper indents back to 1.
      listNumber = listNumber.slice(0, indent+1);
    }

    // Create a marker to cover this series of sentinel characters.
    // NOTE: The reason we treat them as a group (one marker for all subsequent sentinel characters instead of
    // one marker for each sentinel character) is that CodeMirror seems to get angry if we don't.
    var markerOptions = { inclusiveLeft: true, collapsed: true };
    if (element) {
      markerOptions.replacedWith = element;
    }
    var marker = cm.markText({line: line, ch: startIndex }, { line: line, ch: endIndex }, markerOptions);
    // track that it's a line-sentinel character so we can identify it later.
    marker.isForLineSentinel = true;
  };

  RichTextCodeMirror.prototype.makeOrderedListElement_ = function(number) {
    return utils.elt('div', number + '.', {
      'class': 'firepad-list-left'
    });
  };

  RichTextCodeMirror.prototype.makeUnorderedListElement_ = function() {
    return utils.elt('div', '\u2022', {
      'class': 'firepad-list-left'
    });
  };

  RichTextCodeMirror.prototype.toggleTodo = function(noRemove) {
    var attribute = ATTR.LIST_TYPE;
    var currentAttributes = this.getCurrentLineAttributes_();
    var newValue;
    if (!(attribute in currentAttributes) || ((currentAttributes[attribute] !== 't') && (currentAttributes[attribute] !== 'tc'))) {
      newValue = 't';
    } else if (currentAttributes[attribute] === 't') {
      newValue = 'tc';
    } else if (currentAttributes[attribute] === 'tc') {
      newValue = noRemove ? 't' : false;
    }
    this.setLineAttribute(attribute, newValue);
  };

  RichTextCodeMirror.prototype.makeTodoListElement_ = function(checked, getMarkerLine) {
    var params = {
      'type': "checkbox",
      'class': 'firepad-todo-left'
    };
    if (checked) params['checked'] = true;
    var el = utils.elt('input', false, params);
    var self = this;
    utils.on(el, 'click', utils.stopEventAnd(function(e) {
      self.codeMirror.setCursor({line: getMarkerLine(), ch: 1});
      self.toggleTodo(true);
    }));
    return el;
  };

  RichTextCodeMirror.prototype.lineIsListItemOrIndented_ = function(lineNum) {
    var attrs = this.getLineAttributes_(lineNum);
    return ((attrs[ATTR.LIST_TYPE] || false) !== false) ||
           ((attrs[ATTR.LINE_INDENT] || 0) !== 0);
  };

  RichTextCodeMirror.prototype.onCursorActivity_ = function() {
    var self = this;
    setTimeout(function() {
      self.updateCurrentAttributes_();
    }, 1);
  };

  RichTextCodeMirror.prototype.getCurrentAttributes_ = function() {
    if (!this.currentAttributes_) {
      this.updateCurrentAttributes_();
    }
    return this.currentAttributes_;
  };

  RichTextCodeMirror.prototype.updateCurrentAttributes_ = function(attributes) {
    var cm = this.codeMirror;
    if (attributes){
        this.currentAttributes_ = {};
        for(var attr in attributes) {
            // Don't copy line or entity attributes.
            if (attr !== 'l' && attr !== 'lt' && attr !== 'li' && attr.indexOf(ATTR.ENTITY_SENTINEL) !== 0) {
                this.currentAttributes_[attr] = attributes[attr];
            }
        }
        //console.info('updateCurrentAttributes_',this.currentAttributes_,attributes);
        this.trigger('currentAttributesChange', this.currentAttributes_);
        return;
    }
    var anchor = cm.indexFromPos(cm.getCursor('anchor')), head = cm.indexFromPos(cm.getCursor('head'));
    var pos = head;
    if (anchor > head) { // backwards selection
      // Advance past any newlines or line sentinels.
      while(pos < this.end()) {
        var c = this.getRange(pos, pos+1);
        if (c !== '\n' && c !== LineSentinelCharacter)
          break;
        pos++;
      }
      if (pos < this.end())
        pos++; // since we're going to look at the annotation span to the left to decide what attributes to use.
    } else if (anchor < head) {
      // Back up before any newlines or line sentinels.
      while(pos > 0) {
        c = this.getRange(pos-1, pos);
        if (c === '\n' || c === LineSentinelCharacter)
          break;
        pos--;
      }
    }
    //if there is no selection, we just use cursor pos as is
    //console.log('%cupdateCurrentAttributes_','color:green',pos);
    var spans = this.annotationList_.getAnnotatedSpansForPos(pos);
    this.currentAttributes_ = {};

    var attributes = {};
    // Use the attributes to the left unless they're line attributes (in which case use the ones to the right.
    if (spans.length > 0 && (!(ATTR.LINE_SENTINEL in spans[0].annotation.attributes))) {
      attributes = spans[0].annotation.attributes;
    } else if (spans.length > 1) {
      firepad.utils.assert(!(ATTR.LINE_SENTINEL in spans[1].annotation.attributes), "Cursor can't be between two line sentinel characters.");
      attributes = spans[1].annotation.attributes;
    }
    for(var attr in attributes) {
      // Don't copy line or entity attributes.
      if (attr !== 'l' && attr !== 'lt' && attr !== 'li' && attr.indexOf(ATTR.ENTITY_SENTINEL) !== 0) {
        this.currentAttributes_[attr] = attributes[attr];
      }
    }
    //console.info('updateCurrentAttributes_',this.currentAttributes_,attributes);
    this.trigger('currentAttributesChange', this.currentAttributes_)
  };

  RichTextCodeMirror.prototype.updateCurrentAttributesFromLineAttributes_ = function() {
    var cm = this.codeMirror;
    var anchor = cm.getCursor('anchor'), head = cm.getCursor('head');
    //only should be used for case of joining text, with no selection as a result
    if (anchor.line != head.line) {
      console.warn('Incorrect usage');
      return;
    }
    //prev: ch 0 contains previous line styles/sentinel, so check styles at ch 1
    //now:  this has been fixed in onCodeMirrorChange_, so it's 0 now
    var pos = this.codeMirror.indexFromPos({ line: head.line, ch: 0 });
    var spans = this.annotationList_.getAnnotatedSpansForPos(pos);
    this.currentAttributes_ = {};

    var attributes = {};
    // Use the attributes to the left unless they're line attributes (in which case use the ones to the right.
    if (spans.length > 0 && (!(ATTR.LINE_SENTINEL in spans[0].annotation.attributes))) {
      attributes = spans[0].annotation.attributes;
    } else if (spans.length > 1) {
      firepad.utils.assert(!(ATTR.LINE_SENTINEL in spans[1].annotation.attributes), "Cursor can't be between two line sentinel characters.");
      attributes = spans[1].annotation.attributes;
    }
    for(var attr in attributes) {
      // Don't copy line or entity attributes.
      if (attr !== 'l' && attr !== 'lt' && attr !== 'li' && attr.indexOf(ATTR.ENTITY_SENTINEL) !== 0) {
        this.currentAttributes_[attr] = attributes[attr];
      }
    }
  };

  RichTextCodeMirror.prototype.getCurrentLineAttributes_ = function() {
    var cm = this.codeMirror;
    var anchor = cm.getCursor('anchor'), head = cm.getCursor('head');
    var line = head.line;
    // If it's a forward selection and the cursor is at the beginning of a line, use the previous line.
    if (head.ch === 0 && anchor.line < head.line) {
      line--;
    }
    return this.getLineAttributes_(line);
  };

  RichTextCodeMirror.prototype.getLineAttributes_ = function(lineNum) {
    var attributes = {};
    var line = this.codeMirror.getLine(lineNum);
    if (line.length > 0 && line[0] === LineSentinelCharacter) {
      var lineStartIndex = this.codeMirror.indexFromPos({ line: lineNum, ch: 0 });
      var spans = this.annotationList_.getAnnotatedSpansForSpan(new Span(lineStartIndex, 1));
      firepad.utils.assert(spans.length === 1);
      for(var attr in spans[0].annotation.attributes) {
        attributes[attr] = spans[0].annotation.attributes[attr];
      }
    }
    return attributes;
  };

  RichTextCodeMirror.prototype.clearAnnotations_ = function() {
    this.annotationList_.updateSpan(new Span(0, this.end()), function(annotation, length) {
      return new RichTextAnnotation({ });
    });
  };

  RichTextCodeMirror.prototype.newline = function() {
    var cm = this.codeMirror;
    var self = this;
    if (!this.emptySelection_()) {
      cm.replaceSelection('\n', 'end', '+input');
    } else {
      var cursorLine = cm.getCursor('head').line;
      var lineAttributes = this.getLineAttributes_(cursorLine);
      var listType = lineAttributes[ATTR.LIST_TYPE];

      if (listType && cm.getLine(cursorLine).length === 1) {
        // They hit enter on a line with just a list heading.  Just remove the list heading.
        this.updateLineAttributes(cursorLine, cursorLine, function(attributes) {
          delete attributes[ATTR.LIST_TYPE];
          delete attributes[ATTR.LINE_INDENT];
        });
      } else {
        cm.replaceSelection('\n', 'end', '+input');

        // Copy line attributes forward.
        this.updateLineAttributes(cursorLine+1, cursorLine+1, function(attributes) {
          var text = cm.getLineHandle(cm.getCursor('head').line).text;
          for(var attr in lineAttributes) {
              if (text == '') {
                  // for case when new line added and not old line is split, we want to remove all styles
                  if (attr == 'l') attributes[attr] = lineAttributes[attr];
              }
              else {
                  attributes[attr] = lineAttributes[attr];
              }
          }

          // Don't mark new todo items as completed.
          if (listType === 'tc') attributes[ATTR.LIST_TYPE] = 't';
          self.trigger('newLine', {line: cursorLine+1, attr: attributes});
        });
        // TODO: maybe this code is not needed ATM (attrs are cleared in onCodeMirrorChange_),
        // but it partially fixes old broken texts
        var line = this.codeMirror.getLineHandle(cursorLine+1);
        // we only care about actually new line, not about old line getting split
        if (line.text.length == 1) {
            function removeMarkedSpan(spans, span) {
                var r;
                for (var i = 0; i < spans.length; ++i)
                    if (spans[i] != span) (r || (r = [])).push(spans[i]);
                return r
            }
            line.markedSpans.forEach(function(span){
                if (span.marker.lines.length == 1 && !span.marker.isForLineSentinel) {
                    span.marker.clear();
                    line.markedSpans = removeMarkedSpan(line.markedSpans, span)
                }
                if (span.marker.lines.length == 2) {
                    span.marker.detachLine(line);
                    line.markedSpans = removeMarkedSpan(line.markedSpans, span)
                }
            });
            var pos = this.codeMirror.indexFromPos({ line: cursorLine+1, ch: 0 });
            //console.log(cursorLine+1, pos)
            var spans = [], list = this.annotationList_;
            spans = spans.concat(list.getAnnotatedSpansForPos(pos));
            spans = spans.concat(list.getAnnotatedSpansForPos(pos+1));
            //console.log(fp.firebaseAdapter_.document_.ops)
            //fp.richTextCodeMirror_.annotationList_.count()
            //fp.richTextCodeMirror_.annotationList_.forEach(function(l,a,o){console.log(l,a,o)})
            spans.forEach(function(span){
              if (span.annotation.attributes.fs) {
                var oldSpan = new Span(span.pos, span.length);
                list.updateSpan(oldSpan, function(annotation, length) {
                  delete span.annotation.attributes.fs;
                  return new RichTextAnnotation(span.annotation.attributes);
                });
              }
            });
            //now iterate trough all styles and clear any that don't fit (left from previous lines with different styles)
            this.clearDanglingFontSizeMarksFromLine_(cursorLine+1);
            this.updateCurrentAttributesFromLineAttributes_();
        }
      }
    }
  };

  RichTextCodeMirror.prototype.deleteLeft = function() {
    var cm = this.codeMirror;
    var cursorPos = cm.getCursor('head');
    var lineAttributes = this.getLineAttributes_(cursorPos.line);
    var listType = lineAttributes[ATTR.LIST_TYPE];
    var indent = lineAttributes[ATTR.LINE_INDENT];

    var backspaceAtStartOfLine = this.emptySelection_() && cursorPos.ch === 1;

    if (backspaceAtStartOfLine && listType) {
      // They hit backspace at the beginning of a line with a list heading.  Just remove the list heading.
      this.updateLineAttributes(cursorPos.line, cursorPos.line, function(attributes) {
        delete attributes[ATTR.LIST_TYPE];
        delete attributes[ATTR.LINE_INDENT];
      });
    } else if (backspaceAtStartOfLine && indent && indent > 0) {
      this.unindent();
    } else {
      cm.deleteH(-1, "char");
    }
  };

  RichTextCodeMirror.prototype.deleteRight = function() {
    var cm = this.codeMirror;
    var cursorPos = cm.getCursor('head');

    var text = cm.getLine(cursorPos.line);
    var emptyLine = this.areLineSentinelCharacters_(text);
    var nextLineText = (cursorPos.line + 1 < cm.lineCount()) ? cm.getLine(cursorPos.line + 1) : "";
    if (this.emptySelection_() && emptyLine && nextLineText[0] === LineSentinelCharacter) {
      // Delete the empty line but not the line sentinel character on the next line.
      cm.replaceRange('', { line: cursorPos.line, ch: 0 }, { line: cursorPos.line + 1, ch: 0}, '+input');

      // HACK: Once we've deleted this line, the cursor will be between the newline on the previous
      // line and the line sentinel character on the next line, which is an invalid position.
      // CodeMirror tends to therefore move it to the end of the previous line, which is undesired.
      // So we explicitly set it to ch: 0 on the current line, which seems to move it after the line
      // sentinel character(s) as desired.
      // (see https://github.com/firebase/firepad/issues/209).
      cm.setCursor({ line: cursorPos.line, ch: 0 });
    } else {
      cm.deleteH(1, "char");
    }
  };

  RichTextCodeMirror.prototype.indent = function() {
    this.updateLineAttributesForSelection(function(attributes) {
      var indent = attributes[ATTR.LINE_INDENT];
      var listType = attributes[ATTR.LIST_TYPE];

      if (indent) {
        attributes[ATTR.LINE_INDENT]++;
      } else if (listType) {
        // lists are implicitly already indented once.
        attributes[ATTR.LINE_INDENT] = 2;
      } else {
        attributes[ATTR.LINE_INDENT] = 1;
      }
    });
  };

  RichTextCodeMirror.prototype.unindent = function() {
    this.updateLineAttributesForSelection(function(attributes) {
      var indent = attributes[ATTR.LINE_INDENT];

      if (indent && indent > 1) {
        attributes[ATTR.LINE_INDENT] = indent - 1;
      } else {
        delete attributes[ATTR.LIST_TYPE];
        delete attributes[ATTR.LINE_INDENT];
      }
    });
  };

  /**
   * codemirror's posFromIndex only returns actual text, but we need same functionality
   * but the one that accounts entities text representation
   * @returns {Pos}
   */
  RichTextCodeMirror.prototype.posFromTextIndex = function( textIndex ) {
    var ch = 0,
        lineNo = this.codeMirror.doc.first,
        first = this.codeMirror.doc.first,
        size = this.codeMirror.doc.size,
        entityManager = this.entityManager_;
    this.codeMirror.doc.iterN(first, first + size, function( line ) {
      var text = line.text,
          pos = 0,
          entitySentinel, entity,
          entityText, entitiesTextLength = 0,
          lineHasLineSentinel = text.indexOf(LineSentinelCharacter) != -1;
      text = text.replace(new RegExp(LineSentinelCharacter, "g"), '');
      /**
       * charindex | 0  1  2__  3  4  5_  6  7  8_  9  10
       * text      | a  a  bbb  c  c  dd  e  e  ff  g  g
       * textindex | 0  1  234  5  6  78  9  10
       *
       * charindex |  0                  19        29             44
       * text      | "uppörda fientliga ▯ och luft▯an lägningarna▯▯4"
       * text      | "uppörda fientliga angreepp lawnd och luftDe äldstaan lägningarnareviewgår4"
       * textindex |  0                 18            32       41       50            64       73
       */
      // this logic assumes that we can't partially mark entity
      // but this can be changed in future by adding support for text-entities
      // (is there anything except links? collapsible ranges probably?)
      while ( (pos = text.indexOf(EntitySentinelCharacter)) != -1 ) {
        entitySentinel = line.markedSpans.reduce(function( p, c ) {
          var add = lineHasLineSentinel ? 1 : 0;
          //TODO: this should be debugged and reported to firepad/codemirror probably
          //there may be some additional problem related to missing spaces on windows
          //I was unable to repro it on older Ubuntu at home and THIS problem also not appearing here
          var ret;
          if (c.marker.replacedWith && c.marker.replacedWith.tagName.toLowerCase() == 'img') {
            var from = c.from > 0 ? c.from : 1;
            ret = c.marker.replacedWith != null && (from + entitiesTextLength) == (pos + add) ? c : p;
            //TODO: see PRDEV-2395 for why this happens, it's just a quick hack for that case, that will probably work in most cases
            if (!ret) {
              ret = c.marker.replacedWith != null && (c.from + entitiesTextLength) == (pos + add) ? c : p;
            }
          } else {
            ret = c.marker.replacedWith != null && (c.from + entitiesTextLength) == (pos + add) ? c : p;
          }
          return ret;
        }, null);
        entity = entityManager.fromElement(entitySentinel.marker.replacedWith);
        entityText = entityManager.exportToText(entity);
        // before replacing entity, check if we already surpassed searched index
        if (pos - entitiesTextLength > textIndex) {
          break;
        }
        // if entity is too long, break on start of it, if it's at beginning
        // or at the end of it, if it's inside (so we can mark whole entity)
        if ( pos - entitiesTextLength + (entityText.length - 1) >= textIndex ) {
          if (pos - entitiesTextLength == textIndex) {
            ch = pos - entitiesTextLength;
          } else {
            ch = pos - entitiesTextLength + 1;
          }
          return true;
        }
        text = text.replace(EntitySentinelCharacter, entityText);
        // advance position by the length of entity
        entitiesTextLength += entityText.length - 1;
        textIndex -= (entityText.length - 1);
      }
      // +1 is for newline, that is converted to text
      var sz = text.length + 1;
      if ( sz - entitiesTextLength >= textIndex ) {
        ch = textIndex;
        // text pasted to codemirror may not add line sentinels, so we need to remove one additional char
        if (!lineHasLineSentinel) ch--;
        return true
      }
      textIndex -= (sz - entitiesTextLength);
      ++lineNo
    });
    return ({ line: lineNo, ch: ch })
  };

  /**
   * returns text that has entities replaced with their text representation (or with nbsp;)
   * @returns {string}
   */
  RichTextCodeMirror.prototype.getText = function() {
    var output        = '',
        lineNumber = 0,
        lineSep       = this.codeMirror.lineSeparator(),
        entityManager = this.entityManager_;

    this.codeMirror.eachLine(function( line ) {
      var text = line.text,
          pos,
          entitySentinel, entity,
          entityText, entitiesTextLength = 0,
          lineHasLineSentinel = text.indexOf(LineSentinelCharacter) != -1;
      text = text.replace(new RegExp(LineSentinelCharacter, "g"), '');
      while ( (pos = text.indexOf(EntitySentinelCharacter)) != -1 ) {
        entitySentinel = line.markedSpans.reduce(function( p, c ) {
          var add = lineHasLineSentinel ? 1 : 0;
          //TODO: this should be debugged and reported to firepad/codemirror probably
          //there may be some additional problem related to missing spaces on windows
          //I was unable to repro it on older Ubuntu at home and THIS problem also not appearing here
          var ret;
          if (c.marker.replacedWith && c.marker.replacedWith.tagName.toLowerCase() == 'img') {
            var from = c.from > 0 ? c.from : 1;
            ret = c.marker.replacedWith != null && (from + entitiesTextLength) == (pos + add) ? c : p;
              //TODO: see PRDEV-2395 for why this happens, it's just a quick hack for that case, that will probably work in most cases
              if (!ret) {
                ret = c.marker.replacedWith != null && (c.from + entitiesTextLength) == (pos + add) ? c : p;
              }
          } else {
            ret = c.marker.replacedWith != null && (c.from + entitiesTextLength) == (pos + add) ? c : p;
          }
          return ret;
        }, null);
        entity = entityManager.fromElement(entitySentinel.marker.replacedWith);
        entityText = entityManager.exportToText(entity);
        entitiesTextLength += entityText.length - 1;
        text = text.replace(EntitySentinelCharacter, entityText);
      }
      output += (lineNumber > 0 ? lineSep : '') + text;
      lineNumber++;
    });

    return output;
  };

  RichTextCodeMirror.prototype.areLineSentinelCharacters_ = function(text) {
    for(var i = 0; i < text.length; i++) {
      if (text[i] !== LineSentinelCharacter)
        return false;
    }
    return true;
  };

  /**
   * Used for the annotations we store in our AnnotationList.
   * @param attributes
   * @constructor
   */
  function RichTextAnnotation(attributes) {
    this.attributes = attributes || { };
  }

  RichTextAnnotation.prototype.equals = function(other) {
    if (!(other instanceof RichTextAnnotation)) {
      return false;
    }
    var attr;
    for(attr in this.attributes) {
      if (other.attributes[attr] !== this.attributes[attr]) {
        return false;
      }
    }

    for(attr in other.attributes) {
      if (other.attributes[attr] !== this.attributes[attr]) {
        return false;
      }
    }

    return true;
  };

  function emptyAttributes(attributes) {
    for(var attr in attributes) {
      return false;
    }
    return true;
  }

  // Bind a method to an object, so it doesn't matter whether you call
  // object.method() directly or pass object.method as a reference to another
  // function.
  function bind (obj, method) {
    var fn = obj[method];
    obj[method] = function () {
      return fn.apply(obj, arguments);
    };
  }

  return RichTextCodeMirror;
})();
