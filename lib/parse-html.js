var firepad = firepad || { };

/**
 * Helper to parse html into Firepad-compatible lines / text.
 * @type {*}
 */
firepad.ParseHtml = (function () {
  var LIST_TYPE = firepad.LineFormatting.LIST_TYPE;

  /**
   * Represents the current parse state as an immutable structure.  To create a new ParseState, use
   * the withXXX methods.
   *
   * @param opt_listType
   * @param opt_lineFormatting
   * @param opt_textFormatting
   * @constructor
   */
  function ParseState(opt_listType, opt_lineFormatting, opt_textFormatting) {
    this.listType = opt_listType || LIST_TYPE.UNORDERED;
    this.lineFormatting = opt_lineFormatting || firepad.LineFormatting();
    this.textFormatting = opt_textFormatting || firepad.Formatting();
  }

  ParseState.prototype.withTextFormatting = function(textFormatting) {
    return new ParseState(this.listType, this.lineFormatting, textFormatting);
  };

  ParseState.prototype.withLineFormatting = function(lineFormatting) {
    return new ParseState(this.listType, lineFormatting, this.textFormatting);
  };

  ParseState.prototype.withListType = function(listType) {
    return new ParseState(listType, this.lineFormatting, this.textFormatting);
  };

  ParseState.prototype.withIncreasedIndent = function() {
    var lineFormatting = this.lineFormatting.indent(this.lineFormatting.getIndent() + 1);
    return new ParseState(this.listType, lineFormatting, this.textFormatting);
  };

  ParseState.prototype.withAlign = function(align) {
    var lineFormatting = this.lineFormatting.align(align);
    return new ParseState(this.listType, lineFormatting, this.textFormatting);
  };

  /**
   * Mutable structure representing the current parse output.
   * @constructor
   */
  function ParseOutput() {
    this.lines = [ ];
    this.currentLine = [];
    this.currentLineListItemType = null;
  }

  // it removes empty lines from MS Word markup
  ParseOutput.prototype.skipEmptyLines = function() {
    var i = 0;
    while (this.currentLine.length>i) {
      var line = this.currentLine[i];
      var text = line.text;
      if ( !text /*|| !text.trim().length*/ )
        this.currentLine.splice(i, 1);
      else
        i++;
    };
  };

  ParseOutput.prototype.newlineIfNonEmpty = function(state) {
    this.cleanLine_(true);
    this.skipEmptyLines();
    if (this.currentLine.length > 0) {
      this.newline(state);
    }
  };

  ParseOutput.prototype.newlineIfNonEmptyOrListItem = function(state) {
    this.cleanLine_(true);
    if (this.currentLine.length > 0 || this.currentLineListItemType !== null) {
      this.newline(state);
    }
  };

  ParseOutput.prototype.newline = function(state) {
    this.cleanLine_();
    var lineFormatting = state.lineFormatting;
    if (this.currentLineListItemType !== null) {
      lineFormatting = lineFormatting.listItem(this.currentLineListItemType);
      this.currentLineListItemType = null;
    }

    this.lines.push(firepad.Line(this.currentLine, lineFormatting));
    this.currentLine = [];
  };

  ParseOutput.prototype.makeListItem = function(type) {
    this.currentLineListItemType = type;
  };

  ParseOutput.prototype.cleanLine_ = function(ignoreNbsps) {
    // Kinda' a hack, but we remove leading and trailing spaces and newlines (since these aren't significant in html) and
    // replaces nbsp's with normal spaces.
    if (this.currentLine.length > 0) {
      var last = this.currentLine.length - 1;
      this.currentLine[0].text = this.currentLine[0].text.replace(/^[\s\n]+/, '');
      this.currentLine[last].text = this.currentLine[last].text.replace(/[\s\n]+$/g, '');
      if (!ignoreNbsps) {
        for(var i = 0; i < this.currentLine.length; i++) {
          this.currentLine[i].text = this.currentLine[i].text.replace(/\u00a0/g, ' ');
        }
      }
    }
    // If after stripping trailing whitespace, there's nothing left, clear currentLine out.
    if (this.currentLine.length === 1 && this.currentLine[0].text === '') {
      this.currentLine = [];
    }
  };

  var entityManager_, codeMirror_;
  function parseHtml(html, entityManager, codeMirror) {
    if (!html) html = '';
    html =(new DOMParser()).parseFromString(html, 'text/html').body.innerHTML;//strip head, body, html tags
    //console.info('parseHtml', html)
    // Create DIV with HTML (as a convenient way to parse it).
    var div = (firepad.document || document).createElement('div');
    div.innerHTML = html;

    // HACK until I refactor this.
    entityManager_ = entityManager;
    codeMirror_ = codeMirror;

    var output = new ParseOutput();
    var state = new ParseState();
    parseNode(div, state, output);

    return output.lines;
  }

  // Fix IE8.
  var Node = Node || {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3
  };

  function parseNode(node, state, output) {
    // Give entity manager first crack at it.
    //console.info('parseNode', node)
    if (node.nodeType === Node.ELEMENT_NODE) {
      var entity = entityManager_.fromElement(node);
      if (entity) {
        output.currentLine.push(new firepad.Text(
            firepad.sentinelConstants.ENTITY_SENTINEL_CHARACTER,
            new firepad.Formatting(entity.toAttributes())
        ));
        return;
      }
    }

    switch (node.nodeType) {
      case Node.TEXT_NODE:
        // replace spaces with &nbsp; so they can withstand cleanLine_
        var text = node.nodeValue.replace(/ /g, '\u00a0');
        // replace newlines with &nbsp; since newlines doesn't matter in html (except pre tags)
        text = node.nodeValue.replace(/\n/g, '\u00a0');
        output.currentLine.push(firepad.Text(text, state.textFormatting));
        break;
      case Node.ELEMENT_NODE:
        var style = node.getAttribute('style') || '';
        state = parseStyle(state, style);
        switch (node.nodeName.toLowerCase()) {
          case 'div':
          case 'h1':
          case 'h2':
          case 'h3':
          case 'p':
            output.newlineIfNonEmpty(state);
            parseChildren(node, state, output);
            output.newlineIfNonEmpty(state);
            break;
          case 'center':
            state = state.withAlign('center');
            output.newlineIfNonEmpty(state);
            parseChildren(node, state.withAlign('center'), output);
            output.newlineIfNonEmpty(state);
            break;
          case 'b':
          case 'strong':
            parseChildren(node, state.withTextFormatting(state.textFormatting.bold(true)), output);
            break;
          //case 'u':
            // parseChildren(node, state.withTextFormatting(state.textFormatting.underline(true)), output);
            // break;
          case 'i':
          case 'em':
            parseChildren(node, state.withTextFormatting(state.textFormatting.italic(true)), output);
            break;
          //case 's':
            // parseChildren(node, state.withTextFormatting(state.textFormatting.strike(true)), output);
            // break;
          //case 'font':
            // var face = node.getAttribute('face');
            // var color = node.getAttribute('color');
            // var size = parseInt(node.getAttribute('size'));
            // if (face) { state = state.withTextFormatting(state.textFormatting.font(face)); }
            // if (color) { state = state.withTextFormatting(state.textFormatting.color(color)); }
            // if (size) { state = state.withTextFormatting(state.textFormatting.fontSize(size)); }
            // parseChildren(node, state, output);
            // break;
          case 'br':
            output.newline(state);
            break;
          case 'ul':
            output.newlineIfNonEmptyOrListItem(state);
            var listType = node.getAttribute('class') === 'firepad-todo' ? LIST_TYPE.TODO : LIST_TYPE.UNORDERED;
            parseChildren(node, state.withListType(listType).withIncreasedIndent(), output);
            output.newlineIfNonEmpty(state);
            break;
          case 'ol':
            output.newlineIfNonEmptyOrListItem(state);
            parseChildren(node, state.withListType(LIST_TYPE.ORDERED).withIncreasedIndent(), output);
            output.newlineIfNonEmpty(state);
            break;
          case 'li':
            parseListItem(node, state, output);
            break;
          case 'style': // ignore.
            break;
          default:
            parseChildren(node, state, output);
            break;
        }
        break;
      default:
        // Ignore other nodes (comments, etc.)
        break;
    }
  }

  function parseChildren(node, state, output) {
    if (node.hasChildNodes()) {
      for(var i = 0; i < node.childNodes.length; i++) {
        parseNode(node.childNodes[i], state, output);
      }
    }
  }

  function parseListItem(node, state, output) {
    // Note: <li> is weird:
    // * Only the first line in the <li> tag should be a list item (i.e. with a bullet or number next to it).
    // * <li></li> should create an empty list item line; <li><ol><li></li></ol></li> should create two.

    output.newlineIfNonEmptyOrListItem(state);

    var listType = (node.getAttribute('class') === 'firepad-checked') ? LIST_TYPE.TODOCHECKED : state.listType;
    output.makeListItem(listType);
    var oldLine = output.currentLine;

    parseChildren(node, state, output);

    if (oldLine === output.currentLine || output.currentLine.length > 0) {
      output.newline(state);
    }
  }

  function styleEqual(s1,s2) {
    s1=s1.toLowerCase(); // lower
    s1=s1.split(' ').join(''); // remove spaces
    s1=s1.lastIndexOf(";") == s1.length - 1 ?  s1.substring(0,  s1.length -1 ) : s1; // remove trailing ;
    s2=s2.toLowerCase(); // lower
    s2=s2.split(' ').join(''); // remove spaces
    s2=s2.lastIndexOf(";") == s2.length - 1 ?  s2.substring(0,  s2.length -1 ) : s2; // remove trailing ;
    return s1==s2;
  }

  function parseStyle(state, styleString) {
    if (!this.firepadDefaultStyles) {
      // caching some default styles needed later
      var style = window.getComputedStyle(codeMirror_.getWrapperElement());
      this.firepadDefaultStyles={
        fontFamily: style.getPropertyValue('font-family'),
        fontSize: style.getPropertyValue('font-size'),
        backgroundColor: style.getPropertyValue('background-color'),
        color: style.getPropertyValue('color'),
        textAlign: style.getPropertyValue('text-align'),
        //TODO: @anton set it from frontend app config
        availableSizes: [14, 16, 20, 25, 30]
      };
    }

    var textFormatting = state.textFormatting;
    var lineFormatting = state.lineFormatting;
    var styles = styleString.split(';');
    for(var i = 0; i < styles.length; i++) {
      var stylePieces = styles[i].split(':');
      if (stylePieces.length !== 2)
        continue;
      var prop = firepad.utils.trim(stylePieces[0]).toLowerCase();
      var val = firepad.utils.trim(stylePieces[1]).toLowerCase();
        switch (prop) {
            //remove a text formating wich is not customizing due to PRDEV-1334
            //case 'text-decoration':
            //    var underline = val.indexOf('underline') >= 0;
            //    var strike = val.indexOf('line-through') >= 0;
            //    textFormatting = textFormatting.underline(underline).strike(strike);
            //    break;
            case 'font-weight':
                var bold = (val === 'bold') || parseInt(val) >= 600;
                textFormatting = textFormatting.bold(bold);
                break;
            case 'font-style':
                var italic = (val === 'italic' || val === 'oblique');
                textFormatting = textFormatting.italic(italic);
                break;
            //remove a text formating wich is not customizing due to PRDEV-1334
            //case 'color':
            //    if (styleEqual(val, this.firepadDefaultStyles.color)) break;
            //    textFormatting = textFormatting.color(val);
            //    break;
            case 'qmid':
                textFormatting = textFormatting.qmid(val);
                break;
            case 'qmclass':
                textFormatting = textFormatting.qmclass();
                break;
            //remove a text formating wich is not customizing due to PRDEV-1334
            //case 'background-color':
            //    if (styleEqual(val, this.firepadDefaultStyles.backgroundColor)) break;
            //    textFormatting = textFormatting.backgroundColor(val);
            //    break;
            case 'text-align':
                if (styleEqual(val, this.firepadDefaultStyles.textAlign)) break;
                lineFormatting = lineFormatting.align(val);
                break;
            case 'font-size':
                if (styleEqual(val, this.firepadDefaultStyles.fontSize)) break;
                var size = null;
                var allowedValues = ['px'/*,'pt','%','em','xx-small','x-small','small','medium','large','x-large','xx-large','smaller','larger'*/];
                if (firepad.utils.stringEndsWith(val, allowedValues)) {
                    size = val;
                }
                else if (parseInt(val)) {
                    size = parseInt(val)+'px';
                }
                if (size && this.firepadDefaultStyles.availableSizes.indexOf(parseInt(size)) > -1) {
                    textFormatting = textFormatting.fontSize(size);
                }
                else {
                    textFormatting = textFormatting.fontSize(this.firepadDefaultStyles.fontSize);
                }
                break;
            //remove a text formating wich is not customizing due to PRDEV-1334
            //case 'font-family':
            //    if (styleEqual(val, this.firepadDefaultStyles.fontFamily)) break;
            //    var font = firepad.utils.trim(val.split(',')[0]); // get first font.
            //    font = font.replace(/['"]/g, ''); // remove quotes.
            //    font = font.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase() });
            //    textFormatting = textFormatting.font(font);
            //    break;
        }
    }
    return state.withLineFormatting(lineFormatting).withTextFormatting(textFormatting);
  }

  return parseHtml;
})();
