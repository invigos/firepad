var firepad = firepad || { };

firepad.RichTextToolbar = (function(global) {
  var utils = firepad.utils;

  function RichTextToolbar(imageInsertionUI, toolbarItems) {
    this.imageInsertionUI = imageInsertionUI;
    this.toolbarItems = toolbarItems;
    this.element_ = this.makeElement_();
  }

  utils.makeEventEmitter(RichTextToolbar, ['bold', 'italic', 'underline', 'strike', 'font', 'font-size', 'color',
    'left', 'center', 'right', 'unordered-list', 'ordered-list', 'todo-list', 'indent-increase', 'indent-decrease',
    'undo', 'redo', 'insert-image', 'zoom', 'cut', 'copy', 'paste', 'search', 'link', 'format-paragraph', 'import']);

  RichTextToolbar.prototype.element = function() { return this.element_; };

  RichTextToolbar.prototype.makeButton_ = function(eventName, iconName) {
    var self = this;
    iconName = iconName || eventName;
    var btn = utils.elt('a', [utils.elt('span', '', { 'class': 'firepad-tb-' + iconName } )], { 'class': 'firepad-btn' });
    utils.on(btn, 'click', utils.stopEventAnd(function() { self.trigger(eventName); }));
    return btn;
  }

  RichTextToolbar.prototype.makeElement_ = function() {
    var self = this;

    var toolbarOptions = [];

    for (var i in this.toolbarItems) {
      switch(this.toolbarItems[i]){
        case 'zoom': 
          var zoom = this.makeZoomDropdown_();
          toolbarOptions.push(utils.elt('div', [zoom], { 'class': 'firepad-btn-group'}));
          break;
        case 'fontfamily':
          var font = this.makeFontDropdown_();
          toolbarOptions.push(utils.elt('div', [font], { 'class': 'firepad-btn-group'}));
          break;
        case 'fontsize': 
          var fontSize = this.makeFontSizeDropdown_();
          toolbarOptions.push(utils.elt('div', [fontSize], { 'class': 'firepad-btn-group'}));
          break;
        case 'color':
          var color = this.makeColorDropdown_();
          toolbarOptions.push(utils.elt('div', [color], { 'class': 'firepad-btn-group'}));
          break;
        case 'fontstyle': 
          toolbarOptions.push(utils.elt('div', [self.makeButton_('bold'), self.makeButton_('italic')], { 'class': 'firepad-btn-group'}));
          break;
        case 'clipboard':
          toolbarOptions.push(utils.elt('div', [self.makeButton_('cut'), self.makeButton_('copy'), self.makeButton_('paste')], { 'class': 'firepad-btn-group'}));
          break;
        case 'lists': 
          toolbarOptions.push(utils.elt('div', [self.makeButton_('unordered-list', 'list-2'), self.makeButton_('ordered-list', 'numbered-list')], { 'class': 'firepad-btn-group'}));
          break;
        case 'align':
          toolbarOptions.push(utils.elt('div', [self.makeButton_('left', 'paragraph-left'), self.makeButton_('center', 'paragraph-center'), self.makeButton_('right', 'paragraph-right')], { 'class': 'firepad-btn-group'}));
          break;
        case 'indent':
          toolbarOptions.push(utils.elt('div', [self.makeButton_('indent-decrease'), self.makeButton_('indent-increase')], { 'class': 'firepad-btn-group'}));
          break;
        case 'history': 
          toolbarOptions.push(utils.elt('div', [self.makeButton_('undo'), self.makeButton_('redo')], { 'class': 'firepad-btn-group'}));
          break;
        case 'image':
          if (self.imageInsertionUI) {
            toolbarOptions.push(utils.elt('div', [self.makeButton_('insert-image')], { 'class': 'firepad-btn-group' }));
          }
          break;
        case 'search':
          toolbarOptions.push(utils.elt('div', [self.makeButton_('search')], { 'class': 'firepad-btn-group'}));
          break;
        case 'link':
          toolbarOptions.push(utils.elt('div', [self.makeButton_('link')], { 'class': 'firepad-btn-group'}));
          break;
        case 'swedish_format': 
          var format = this.makeFormatDropdown_();
          toolbarOptions.push(utils.elt('div', [format], { 'class': 'firepad-btn-group'}));
          break;
        case 'import': 
          toolbarOptions.push(utils.elt('div', [self.makeButton_('import')], { 'class': 'firepad-btn-group' }));
          break;
      }
    };

    var toolbarWrapper = utils.elt('div', toolbarOptions, { 'class': 'firepad-toolbar-wrapper' });
    var toolbar = utils.elt('div', null, { 'class': 'firepad-toolbar' });
    toolbar.appendChild(toolbarWrapper)

    return toolbar;
  };

  RichTextToolbar.prototype.makeFontDropdown_ = function() {
    // NOTE: There must be matching .css styles in firepad.css.
    var fonts = ['Arial', 'Comic Sans MS', 'Courier New', 'Impact', 'Times New Roman', 'Verdana'];

    var items = [];
    for(var i = 0; i < fonts.length; i++) {
      var content = utils.elt('span', fonts[i]);
      content.setAttribute('style', 'font-family:' + fonts[i]);
      items.push({ content: content, value: fonts[i] });
    }
    return this.makeDropdown_('Font', 'font', items);
  };

  RichTextToolbar.prototype.makeFontSizeDropdown_ = function() {
    // NOTE: There must be matching .css styles in firepad.css.
    var sizes = [9, 10, 12, 14, 18, 24, 32, 42];

    var items = [];
    for(var i = 0; i < sizes.length; i++) {
      var content = utils.elt('span', sizes[i].toString());
      content.setAttribute('style', 'font-size:' + sizes[i] + 'px; line-height:' + (sizes[i]-6) + 'px;');
      items.push({ content: content, value: sizes[i] });
    }
    return this.makeDropdown_('Size', 'font-size', items, 'px');
  };

  RichTextToolbar.prototype.makeColorDropdown_ = function() {
    var colors = ['black', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'grey'];

    var items = [];
    for(var i = 0; i < colors.length; i++) {
      var content = utils.elt('div');
      content.className = 'firepad-color-dropdown-item';
      content.setAttribute('style', 'background-color:' + colors[i]);
      items.push({ content: content, value: colors[i] });
    }
    return this.makeDropdown_('Color', 'color', items);
  };

  RichTextToolbar.prototype.makeZoomDropdown_ = function() {

    var zooms = [
      { name: '50%', zoom: .5 },
      { name: '75%', zoom: .75 },
      { name: '90%', zoom: .9 },
      { name: '100%', zoom: 1 },
      { name: '125%', zoom: 1.25 },
      { name: '150%', zoom: 1.5 },
      { name: '175%', zoom: 1.75 },
      { name: '200%', zoom: 2 }
    ];

    var items = [];
    for(var i = 0; i < zooms.length; i++) {
      var content = utils.elt('span', zooms[i]['name'].toString());
      var style = 'font-size:14px; line-height:14px;';
      content.setAttribute('style', style);

      items.push({ content: content, value: zooms[i]['zoom'] });
    }
    return this.makeDropdown_('100%', 'zoom', items, '', true);
  };

  /********* CUSTOM INVIGOS DROPDOWN LISTS *********/
  RichTextToolbar.prototype.makeFormatDropdown_ = function() {
    var sizes = [
      { name: 'Vanlig text', size: 14 },
      { name: 'Titel', size: 30 },
      { name: 'Rubrik 1', size: 25 },
      { name: 'Rubrik 2', size: 20 },
      { name: 'Rubrik 3', size: 16 },
      { name: 'Rubrik 4', size: 16.01, underline: true }
    ];

    var items = [];
    for(var i = 0; i < sizes.length; i++) {
      var content = utils.elt('span', sizes[i]['name'].toString());
      var style = 'font-size:' + sizes[i]['size'] + 'px; line-height:' + (sizes[i]['size']-6) + 'px;';
      if(sizes[i]['underline'])
        style += 'text-decoration:underline';
      content.setAttribute('style', style);
      items.push({ content: content, value: sizes[i]['size'] });
    }

    return this.makeDropdown_('Vanlig text', 'format-paragraph', items, 'px', true, 'format-dd');
  };

  RichTextToolbar.prototype.makeDropdown_ = function(title, eventName, items, value_suffix, changeOnSelect, extra_class) {
    value_suffix = value_suffix || "";
    var self = this;
    var button = utils.elt('a', title + ' \u25be', { 'class': 'firepad-btn firepad-dropdown ' + extra_class });
    var list = utils.elt('ul', [ ], { 'class': 'firepad-dropdown-menu' });
    button.appendChild(list);

    var isShown = false;
    function showDropdown() {
      if (!isShown) {
        list.style.display = 'block';
        utils.on(document, 'click', hideDropdown, /*capture=*/true);
        isShown = true;
      }
    }

    var justDismissed = false;
    function hideDropdown() {
      if (isShown) {
        list.style.display = '';
        utils.off(document, 'click', hideDropdown, /*capture=*/true);
        isShown = false;
      }
      // HACK so we can avoid re-showing the dropdown if you click on the dropdown header to dismiss it.
      justDismissed = true;
      setTimeout(function() { justDismissed = false; }, 0);
    }

    function addItem(content, value) {
      if (typeof content !== 'object') {
        content = document.createTextNode(String(content));
      }
      var element = utils.elt('a', [content]);

      utils.on(element, 'click', utils.stopEventAnd(function() {
        hideDropdown();
        self.trigger(eventName, value + value_suffix);

        if(changeOnSelect)
          button.firstChild.nodeValue = element.firstChild.innerHTML + ' \u25be';
      }));

      list.appendChild(element);
    }

    for(var i = 0; i < items.length; i++) {
      var content = items[i].content, value = items[i].value;
      addItem(content, value);
    }

    utils.on(button, 'click', utils.stopEventAnd(function() {
      if (!justDismissed) {
        showDropdown();
      }
    }));

    return button;
  };

  return RichTextToolbar;
})();
