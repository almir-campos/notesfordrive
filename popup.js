
/* TODO


*cleanup google docs html*
    - strip all css elements from style except those starting with .c
    - within those strip all except font-weight, font-style and color
    - strip html/head/meta/body elements
    - replace <p> with <div>
    - eventually replace all elements that use c* classes with margin-left:36 with <blockqoute> (ie. surround the element)

    - Misc bugs
           - sometimes title becomes untitled
           - wordwrap messes with lines
           - saving and loading messes with document formatting slightly
           - indenting and paragraphs can get a little messy
           - remember cursor position per document

 Summernote - numbered lists are not offset correctly
 Summernote - links are shit (hack source to disable)
 Summernote - command text in popovers is shit (hack source to disable)


 THEN
 - add resize handles to bottom-bar

 - offline support
   - store document cache in chrome local storage - upload when connection available

 - open existing doc (save opened doc id's to chrome.storage) + right click menu for choosing this "Open from Drive"
   - could store opened doc id's as properties of the master folder so they are accessible in other browser instances

 - rename note button, close note button (only for opened notes)

 - if not opened/imported or renamed explicitly (store details in chrome storage)
 then use first 5 words or 20 characters as doc title (even if it changes)

 - simple mode (as an option): only show saving status when saving/saved then disappear after 2 seconds, no settings icon, no
 formatting controls (use air mode) -> "Standard UI or Streamlined UI"


 THEN
 - add button to gmail

 - show small image of user last edited by if it was not you and you have not yet seen the changes

 - show photos (with name in popover) of users the file is shared with
 */

/*
 More Extension Ideas

 - Quick Links for Google Drive

    - display a list of google docs that you care about (ie. have choosen to open)
    - clicking one one opens it up directly for editing in Drive
    - it simply needs the doc's title, who/when it was last modified by/ (ie. picture) and if there are
      unseen changes (ie. bold it)
 */


var background = chrome.extension.getBackgroundPage();

// this is used to configure whether interactive re-authentication is enabled on 401's (ie. when access tokens expire)
var port = chrome.runtime.connect( {name: 'popup'} );


document.addEventListener('DOMContentLoaded', function()
{
    setupPopovers();
    setupSummernote();
    setupSortable();

    $('#settings-button').click( function()
    {
        chrome.tabs.create({'url': chrome.extension.getURL("src/options/options.html") } )
    });

    $('#new-button').click( function()
    {
        createDocument();
    });

    $('#authorize-button').click( function()
    {
        checkAuth({interactive:true});
    });

    $('.drive-folder-name').text( background.DEFAULT_FOLDER_NAME );

    window.setTimeout(function()
    {
        checkAuth({interactive:false});
    }, 1);
});


chrome.runtime.onMessage.addListener( function(request, sender, sendResponse)
{
    // this will only be called when the cache has been updated with changes.
    // ie. it won't be called if the Drive was checked and there were no changes
    if(request.cacheUpdated || request.initialCacheUpdateComplete)
    {
        displayDocs();
    }

    // this will be sent from any gdrive calls that fail to re-authenticate
    if(request.authenticationFailed)
    {
        authenticationFailed();
    }
});


function setupSummernote()
{
    $('.summernote').summernote(
      {
          height: 375,

          minHeight: 375,  // set minimum height of editor
          maxHeight: 375,  // set maximum height of editor

          focus: false,

          toolbar: [
              ['style', ['bold', 'italic', 'underline']],
              ['fontsize', ['fontsize']],
              ['color', ['color']],
              ['para', ['ul', 'ol']]
          ],

          onfocus: onDocumentFocus,
          onChange: onDocumentChange
      });

    $('.note-editor').css('border', 'none');
    $('.note-resizebar').css('display', 'none');
}


function setupPopovers()
{
    var $popoverSelector = $('#active-note-actions > .trigger');

    $popoverSelector.popover(
    {
        html: true,
        content: function() {
            return $(this).parent().find('.popover-content').html();
        },
        container: 'body',
        placement: 'top'
    });

    // hide popovers on click outside the popover button
    $('body').on('click', function(e)
    {
        $('[data-toggle="popover"]').each( function()
        {
            //the 'is' for buttons that trigger popups
            //the 'has' for icons within a button that triggers a popup
            if (!$(this).is(e.target) && $(this).has(e.target).length === 0 && $('.popover').has(e.target).length === 0) {
                $(this).popover('hide');
            }
        });
    });

    $(document).on("click", "#active-item-trash", function()
    {
        var activeDoc = $('.summernote').data('editing-doc');

        if(activeDoc)
            trashDocument(activeDoc);

        $popoverSelector.popover('hide');
    });

    $(document).on("click", "#active-item-drive", function()
    {
        var activeDoc = $('.summernote').data('editing-doc');

        if(activeDoc && activeDoc.item)
            chrome.tabs.create({ url: activeDoc.item.alternateLink });

        $popoverSelector.popover('hide');
    });
}


function setupSortable()
{
    $("#notes-list").sortable(
    {
        stop: function(event, ui)
        {
            reorderDocumentCacheForDivs();
            updateActiveArrow();
        }
    });
}


function onDocumentFocus(e)
{
    var doc = $('.summernote').data('editing-doc');

    if(doc)
    {
        doc.cursorPos = document.getSelection().anchorOffset;
        console.log("onDocumentFocus doc.cursorPos = " + doc.cursorPos);
    }
}

function onDocumentChange(contents, $editable)
{
    var doc = $('.summernote').data('editing-doc');

    if(doc)
    {
        doc.dirty = true;
        doc.cursorPos = document.getSelection().anchorOffset;
        doc.contentHTML = $('.summernote').code();

        updateDocumentTitle(doc);
        saveDocument(doc);

        console.log("doc.cursorPos = " + doc.cursorPos);
    }
}


function checkAuth(options)
{
    if(!navigator.onLine)
    {
        updateDisplay();
        return;
    }

    if( !background.gdrive.oauth.hasAccessToken() )
    {
        background.gdrive.auth(options, authenticationSucceeded, authenticationFailed);
    }
    else
    {
        //background.gdrive.oauth.printAccessTokenData();

        // we have an access token - even if its expired it will be automatically refreshed on the next server call
        authenticationSucceeded();
    }
}

function authenticationSucceeded()
{
    displayDocs();

    // update the cache every time the user opens the popup incase changes have been made to the documents in drive
    background.updateCache();
}

function authenticationFailed()
{
    updateDisplay();
}


function displayDocs()
{
    $("#notes-list").empty();

    if(background.cache.documents.length)
    {
        $.each(background.cache.documents, function(index, doc)
        {
            addDocument(doc);

            if(background.lastActiveDocId && doc.item && background.lastActiveDocId == doc.item.id)
            {
                setActiveDoc(doc);
            }
        });

        // if we didn't set an active doc then set the first
        if( $('.active').length == 0 )
        {
            setActiveDoc( background.cache.documents[0] );
        }
    }

    updateDisplay();
}


function addDocument(doc)
{
    // we wont have an item if we've got a doc from createDocument and it hasn't yet been saved
    var id = doc.item ? doc.item.id : guid();

    var e = $("<div class='notes-list-item'/>");
    e.attr('id', id);
    e.data('doc', doc);

    doc.$notesListElement = e;

    e.click(function()
    {
        setActiveDoc(doc);
    });

    e.append( $("<p>" + doc.title + "</p>") );

    $("#notes-list").append( e );
    $("#notes-list").sortable('refresh');

    recalculateSpacerHeight();
}


function setActiveDoc(doc)
{
    // NOTE: if the current active document has pending changes then it will still have
    // a timer running on it that will save the changes

    if(!doc)
    {
        updateDisplay();
        return;
    }

    // don't do anything if we're already the active doc
    if( isActiveDoc(doc) )
      return;

    setLastActiveDocument(doc);


    $('.summernote').code(doc.contentHTML);
    $('.summernote').data('editing-doc', doc);

    focusActiveInput();


    $('#active-note-status').empty();
    if(doc.item) {
        $('#active-note-status').text('Last change was ' + moment(doc.item.modifiedDate).fromNow());
    }


    var $listItem = doc.$notesListElement;

    $('.notes-list-item').removeClass('active');
    $listItem.addClass('active');

    updateActiveArrow();
    updateDisplay();
}


function trashDocument(doc)
{
    if(doc.item)
        background.gdrive.trashFile(doc.item.id);

    doc.$notesListElement.remove();
    recalculateSpacerHeight();

    var documents = background.cache.documents;

    // remove the document from the cache
    var index = documents.indexOf(doc);
    if(index > -1) {
        documents.splice(index, 1);
    }

    // display the next available document
    var nextDoc = null;

    if(documents.length > 0)
    {
        if(index > 0) {
            nextDoc = documents[index - 1];
        }
        else
            nextDoc = documents[index];
    }

    setActiveDoc(nextDoc);
}


function createDocument(title, content)
{
    title = title || 'New Note';
    content = content || '';

    var doc = {
        item: null,
        title: title,
        contentHTML: content,
        requiresInsert: true
    };

    background.cache.documents.push(doc);

    addDocument(doc);
    setActiveDoc(doc);
}


function saveDocument(doc)
{
    if(!doc || !doc.dirty || doc.saving)
        return;

    var started = function()
    {
        if( isActiveDoc(doc) )
        {
            $('#active-note-status').text('Saving..');
        }
    }

    var completed = function()
    {
        if( isActiveDoc(doc) )
        {
            // update the last active doc id with the new doc.item.id (for newly inserted docs)
            setLastActiveDocument(doc);

            $('#active-note-status').text('All changes saved to Drive');
        }
    };

    // we do a save on the background thread so that it will continue to save
    // outstanding changes even if the popup is closed
    background.saveDocument(doc, started, completed);
}


function updateActiveArrow()
{
    $('.notes-list-item .arrow').remove();

    var activeDoc = $('.summernote').data('editing-doc');

    if(activeDoc)
    {
        var isFirst = background.cache.documents[0] == activeDoc;
        var arrowIcon = isFirst ? "notes-arrow-light-grey.png" : "notes-arrow.png";

        activeDoc.$notesListElement.prepend( $("<img class='arrow' src='img/" + arrowIcon + "'/>") );
    }
}


function showSection(div)
{
    showSections( [div] );
}

function showSections(divs)
{
    $('#auth-section').toggle( arrayContains('#auth-section', divs) );
    $('#message-section').toggle( arrayContains('#message-section', divs) );
    $('#loading-section').toggle( arrayContains('#loading-section', divs) );
    $('#first-use-section').toggle( arrayContains('#first-use-section', divs) );
    $('#documents-section').toggle( arrayContains('#documents-section', divs) );

    $('#notes-list-buttons').toggle( arrayContains('#notes-list-buttons', divs) );
    $('#active-note-footer').toggle( arrayContains('#active-note-footer', divs) );
}


function updateDisplay()
{
    if(!navigator.onLine)
    {
        showSection('#message-section');

        $("#message-content").text("You don't appear to have an internet connection.");
        $('#message-content').center();

        return;
    }

    if( !background.gdrive.oauth.hasAccessToken() )
    {
        showSection('#auth-section');
        $('#auth-content').center();

        return;
    }
    else
    {
        if(background.state == background.StateEnum.CACHING && background.cache.lastUpdated == null)
        {
            showSection('#loading-section');
            $('#loading-content').center();
        }
        else
        {
            chrome.storage.sync.get('seen-instructions', function(result)
            {
                var hasSeenInstructions = result[ 'seen-instructions' ];

                if(!hasSeenInstructions)
                {
                    $('#first-use-got-it-button').click( function()
                    {
                        chrome.storage.sync.set({'seen-instructions': true});
                        updateDisplay();
                    });

                    showSection('#first-use-section');
                }
                else
                {
                    if(background.cache.documents.length > 0)
                    {
                        showSections( ['#documents-section', '#notes-list-buttons', '#active-note-footer'] );

                        focusActiveInput();
                    }
                    else
                    {
                        showSections( ['#message-section', '#notes-list-buttons'] );

                        $('#message-content').text("You don't have any notes. Create one using the pencil icon below.");
                        $('#message-content').center();
                    }
                }
            });
        }
    }
}


function focusActiveInput()
{
    var activeDoc = $('.summernote').data('editing-doc');

    if(activeDoc)
    {
        $('.summernote').summernote({focus:true});

        if(activeDoc.cursorPos)
            document.getSelection().anchorOffset = activeDoc.cursorPos;
    }
}


function isActiveDoc(doc)
{
    return $('.summernote').data('editing-doc') == doc;
}


function setLastActiveDocument(doc)
{
    if(doc.item)
    {
        background.lastActiveDocId = doc.item.id;
        chrome.storage.sync.set({'last-active-doc-id': doc.item.id});
    }
}


function updateDocumentTitle(doc)
{
    var title = extractTitle(doc.contentHTML);

    if(!title || title.length == 0)
        title = 'Untitled';

    if(title != doc.title)
    {
        doc.title = title;
        doc.$notesListElement.children('p').text(doc.title);
    }
}


/* Example of HTML returned by Summernote
<title>New Note</title>
<meta content="text/html; charset=UTF-8" http-equiv="content-type">
    <style type="text/css">ol{margin:0;padding:0}.c1{color:#000000;font-size:11pt;font-family:"Arial"}.c3{max-width:468pt;background-color:#ffffff;padding:72pt 72pt 72pt 72pt}.c2{height:11pt}.c0{direction:ltr}.title{padding-top:24pt;line-height:1.0;text-align:left;color:#000000;font-size:36pt;font-family:"Arial";font-weight:bold;padding-bottom:6pt;page-break-after:avoid}.subtitle{padding-top:18pt;line-height:1.0;text-align:left;color:#666666;font-style:italic;font-size:24pt;font-family:"Georgia";padding-bottom:4pt;page-break-after:avoid}li{color:#000000;font-size:11pt;font-family:"Arial"}p{color:#000000;font-size:11pt;margin:0;font-family:"Arial"}h1{padding-top:24pt;line-height:1.0;text-align:left;color:#000000;font-size:24pt;font-family:"Arial";font-weight:bold;padding-bottom:24pt}h2{padding-top:22.4pt;line-height:1.0;text-align:left;color:#000000;font-size:18pt;font-family:"Arial";font-weight:bold;padding-bottom:22.4pt}h3{padding-top:24pt;line-height:1.0;text-align:left;color:#000000;font-size:14pt;font-family:"Arial";font-weight:bold;padding-bottom:24pt}h4{padding-top:25.6pt;line-height:1.0;text-align:left;color:#000000;font-size:12pt;font-family:"Arial";font-weight:bold;padding-bottom:25.6pt}h5{padding-top:25.6pt;line-height:1.0;text-align:left;color:#000000;font-size:9pt;font-family:"Arial";font-weight:bold;padding-bottom:25.6pt}h6{padding-top:36pt;line-height:1.0;text-align:left;color:#000000;font-size:8pt;font-family:"Arial";font-weight:bold;padding-bottom:36pt}
    </style>
    <p class="c0">
        <span class="c1">my new note &lt;b&gt;test&lt;/b&gt;last</span>
    </p>
    <p class="c0 c2">
        secondline<span class="c1"></span>
    </p>
    <p class="c0 c2">
        <span style="font-weight: bold;">bold&nbsp;</span>
    </p>
    <p class="c0 c2">
        <ul><li>dot1</li></ul>
    </p>
*/

function extractTitle(html)
{
    if(!html || html.length == 0)
        return null;

    var firstParagraph = contentOfFirstTag('p', html) || contentUntilTag('div', html);
    var text = stripTags(firstParagraph);

    text = text.replace(/&lt;/g, '');
    text = text.replace(/&gt;/g, '');
    text = text.replace(/&nbsp;/g, ' ');

    MAX_TITLE_WORDS = 10;
    return text.split(' ').slice(0, MAX_TITLE_WORDS).join(' ');
}

function contentOfFirstTag(tag, text, startFromIndex)
{
    var start_open_tag = '<'+tag;
    var start_close_tag = '>';
    var end_tag = '</'+tag+'>';

    var start_open_index = text.indexOf(start_open_tag, startFromIndex);
    var start_close_index = text.indexOf(start_close_tag, start_open_index);
    var end_index = text.indexOf(end_tag, start_close_index);

    if(start_open_index < 0)
        return null;

    return text.substring(start_close_index+start_close_tag.length, end_index);
}

function contentUntilTag(tag, text, startFromIndex)
{
    var start_open_tag = '<'+tag;

    var start_open_index = text.indexOf(start_open_tag, startFromIndex);

    if(start_open_index < 0)
        return text;

    return text.substring(0, start_open_index);
}

function stripTags(text)
{
    var stripped = text;

    while(true)
    {
        var start_index = stripped.indexOf('<');
        var end_index = stripped.indexOf('>', start_index);

        if(end_index > 0)
            end_index += 1; // ie. '>' character

        if(end_index >= stripped.length)
            end_index = -1;

        if(start_index >= 0) {
            stripped = removeRange(stripped, start_index, end_index);
        }

        if(start_index < 0 || end_index < 0)
            break;
    }

    return stripped;
}


function removeRange(s, start, end)
{
    var result = s.substring(0, start);

    if(end >= 0)
        result += s.substring(end);

    return result;
}


function stripTag(tag, from)
{
    var start_tag = '<'+tag;
    var end_tag = '</'+tag+'>';

    var start_index = from.indexOf(start_tag);
    var end_index = from.indexOf(end_tag);

    if(start_index >= 0 && end_index >= 0)
    {
        return from.substring(0, start_index) + from.substring(end_index + end_tag.length);
    }
    else if(start_index >= 0)
    {
        end_tag = '>';
        end_index = from.indexOf('>', start_index);

        if(end_index)
            return from.substring(0, start_index) + from.substring(end_index + end_tag.length);
    }

    return from;
}


function arrayContains(needle, arrhaystack)
{
    return (arrhaystack.indexOf(needle) > -1);
}


function reorderDocumentCacheForDivs()
{
    var reordered = [];

    $('#notes-list').children().each( function()
    {
        var doc = $(this).data('doc');

        if(doc)
            reordered.push(doc);
    });

    if(reordered.length == background.cache.documents.length)
    {
        background.cache.documents = reordered;
    }
}

function recalculateSpacerHeight()
{
    var listHeight = $('#notes-list').height();
    var containerHeight = $('#documents-section').height();

    var height = containerHeight - listHeight;

    if(height < 0)
    {
        height = 0;
        $('#notes-list-container').css('overflow-y', 'scroll');
    }
    else
    {
        $('#notes-list-container').css('overflow-y', 'hidden');
    }

    console.log('recalc, container:' + containerHeight + ", list:" + listHeight + ", height:" + height);

    $('#notes-list-space').css('height', (height)+'px');
}

jQuery.fn.cssFloat = function(prop) {
    return parseFloat(this.css(prop)) || 0;
};
