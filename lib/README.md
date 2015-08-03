# Configuration Changes

Theres a file in this level that is called rich-text-toolbar.js. This file has most of the modifications made for the toolbar but one of the main changes is the modification of the way the toolbar is configured. The idea here is to make the toolbar customizable for the developers (we needed this!). So this is an example on how we configure the toolbar now:

```
var firepad = Firepad.fromCodeMirror(firepadRef, codeMirror,
{ 
	richTextToolbar: true, 
	toolbarItems: [ 
		'zoom', 'history', 'swedish_format', 
		'fontstyle', 'clipboard', 'lists', 'align', 
		'search' , 'link', 'import' 
	], 
	richTextShortcuts: true 
});

```

So as you see we have a better control on waht do we want to show on the toolbar now. (the swedish_format is custom because the library doesn't have any i18n implemented);

The toolbar buttons available are the next ones:

* `zoom` - This handles the zooming of the editor (this has a bug with the cursor; when the editor is zoomed the cursor looses the reference to the positions).
* `fontfamily` - as the name says it shows a list of available font-families for the text. The available ones are:
	* Arial
	* Comic Sans MS
	* Courier New
	* Impact
	* Times New Roman
	* Verdana
* `fontsize` - for sizes we have a list of pixel based sizes.
* `color` - this is a list of colors to change the color of the texts (not the background or highlight color).
* `fontstyle` - Compiled (built) files directory
* `clipboard` - cut, copy and paste buttons
* `lists` - bullet list and ordered lists (numbers).
* `align` - left, center and right paragraph alignment.
* `indent` - Indent buttons. Add indentation and remove it.
* `history` - Undo and Redo buttons (firebase history based).
* `image` - this pops up a textfield where you can add a url for an image and it will add it to the editor.

#Specific Invigos buttons we have:

* `swedish_format` - this has a list in swedish for paragraph format styles: Vanlig text, Titel, Rubrik 1, 2, 3, 4. 
* `search` - this only ads the magnifier button and the 'search' event to the editor. The functionality of this button needs to be outside of the library.
* `link` - this only ads the hiperlink button and the 'link' event to the editor. The functionality of this button needs to be outside of the library.
* `import` - this only ads the import button and the 'import' event to the editor. The functionality of this button needs to be outside of the library.


#Stylesheets

Ok, so for the styling firepad has one css file `firepad.css` that you can find in this folder level. This file has some changes in the bottom. Basically the idea was to change the custom icons that firepad uses to use FontAwesome. The reason is because firepad uses some custom made font icons generated with iconmoon (if I'm not mistaken) and that font icons were a little poor on content. To add more buttons and more tools to the toolbar I changed this. So remember to add `Font Awesome` to the project that uses this editor. In case we want to add a new button we have to add the css for the button, for example: 

```
/* THIS CAN BE ADDED TO THE LINE 276 */
.firepad-tb-import {
  font-family: FontAwesome;
}

.firepad-tb-import:before {
  content: "\f019";
}

```








