var liveDb;
var root;

var usersDiv;
var meetingsDiv;
var messagesDiv;

var views = [];

function onLoad( _liveDb, _rootId )
{
    liveDb = _liveDb;
    root = $('#'+_rootId);
    
    // root.empty();
    // root.append($('<h1></h1>').text('Forum'))
    //     .append($('<div></div>').attr('id', 'userContainer')
    //         .append($('<h2></h2>').text('Users'))
    // 	    .append($('<button></button>').text('Prev').click(function(){ usersList.previousSelected() }))
    // 	    .append($('<button></button>').text('Next').click(function(){ usersList.nextSelected() }))
    // 	    .append($('<button></button>').text('First').click(function(){ usersList.first() }))
    // 	    .append($('<button></button>').text('Last').click(function(){ usersList.last() }))
    //         .append($('<div></div>').attr('id', 'users')
    //             .append($('<p></p>').text('Fetching users...'))
    //         )
    // 	    .append($('<button></button>').text('Page up').click(function(){ usersList.previous() }))
    // 	    .append($('<button></button>').text('Page down').click(function(){ usersList.next() }))
    //     )
    //     .append($('<div></div>').attr('id', 'messageContainer')
    //         .append($('<h2></h2>').text('Messages'))
    //         .append($('<div></div>').attr('id', 'messages')
    //             .append($('<p></p>').text('Fetching messages...'))
    //         )
    //         .append($('<textarea></textarea>')
    //             .attr({
    //                 'id': 'message',
    //                 'rows': '5',
    //                 'cols': '80'
    //             })
    //         )
    //         .append($('<br>'))
    //         .append($('<button></button>').click(post).text('New Message'))
    //     );
    // usersDiv = $('#users');
    // messagesDiv = $('#messages');
    // liveDb.list( messagesCallback, '/messages', '->', null, { 'text' : 1, 'u_read' : 1,
    // 							      // 'date' : 1,
    // 							      // 'author' ; { 'name' : 1 }
    // 							    },
    // 		 15, null, null, null );
    // liveDb.get( '/messages', {}, messagesObjCallback );

    viewUsers();
}

function partialViewNavigation( closeView )
{
    // return $('<ul/>', { id:'nav', 'class':'menu' })
    // 	.append($('<li/>', { text:'Users', click:function(){ closeView(); viewUsers(); }}))
    // 	.append($('<li/>', { text:'Meetings', click:function(){ closeView(); viewMeetings(); }}));

    return createMenu( 'menu', [
	{ caption:'Users', click:function(){ closeView(); viewUsers(); }},
	{ caption:'Meetings', click:function(){ closeView(); viewMeetings(); }}
    ], false );
}

function viewUsers( )
{
    var usersList;

    var usersDiv;

    var closeView = function( ) {
	usersList.close();
    };

    var usersCallback = function ( list ) {
	// Redundancy: list == usersList
	var users = list.items();
	var hasOnline = false;
	var hasOffline = false;
	var onlineList = $('<ul/>');
	var offlineList = $('<ul/>');
	for (var i=0; i < users.length; i++)
	{
	    var user = users[i];
	    if (user._online)
	    {
		hasOnline = true;
		onlineList.append($('<li/>', { text:user.name,
					       'class':list.selectedId() == user.id ? 'selected' : 'no-selected' } ));
	    }
	    else
	    {
		hasOffline = true;
		offlineList.append($('<li/>', { text:user.name,
						'class':list.selectedId() == user.id ? 'selected' : 'no-selected' } ));
	    }
	}
	usersDiv.empty();
	if (hasOnline)
	{
	    usersDiv
		.append($('<p/>', { text:'Online' }))
		.append(onlineList);
	}
	if (hasOffline)
	{
	    usersDiv
		.append($('<p/>', { text:'Offline' }))
		.append(offlineList);
	}
	$('#index').text((list.offset() + 1) + '-' + (list.offset() + list.items().length) + ' of ' + list.size());
    };

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container' })
		.append($('<h2/>', { text:'Users', style:'clear:left' }))
		.append($('<div/>', { id:'users' })
			.append($('<p/>', { text:'Fetching users...' }))
		       )
		.append($('<p/>', { id:'index' }))
		.append($('<button/>', { text:'Page up', click:function(){ usersList.previous() }}))
		.append($('<button/>', { text:'Page down', click:function(){ usersList.next() }}))
               );

    usersList = liveDb.list( usersCallback, '/users', '->', null, { '_online':1, 'name':1 },
			     5, null, null, [ { name:'_online', dir:'desc' },
					      { name:'name', dir:'asc', nocase:1 } ] );

    usersDiv = $('#users');
}

function viewMeetings( )
{
    var meetingsList;

    var meetingsDiv;

    var closeView = function( ) {
	meetingsList.close();
    };

    var meetingsCallback = function( list ) {
	var meetings = list.items();
	updateList( 'meetings', meetings );
	// // Redundancy: list == meetingsList
	// var meetings = list.items();
	// meetingsDiv.empty();
	// for (var i=0; i < meetings.length; i++)
	// {
	//     var meeting = meetings[i];
	//     var view = function( m ) { return function () {
	// 	viewMeeting( m );
	//     }};
	//     meetingsDiv.append($('<div/>', { 'class':'meeting'
	// 				     + (list.selectedId() == meeting.id ? ' selected' : ' no-selected'),
	// 				     click:view( meeting ) })
	// 		       .append($('<p/>', { text:meeting.name }))
	// 		       .append($('<p/>', { text:meeting.description }))
	// 		      );
	// }
	// $('#index').text((list.offset() + 1) + '-' + (list.offset() + list.items().length) + ' of ' + list.size());
    };

    meetingsList = liveDb.list( meetingsCallback, '/meetings', '->', null, { 'name':1, 'description':1 },
				5, null, null, [ { name:'name', dir:'asc', nocase:1 },
						 { name:'description', dir:'asc', nocase:1 } ] );


    var $list = createList( 'meetings', meetingsList,
			    [ { name:'name', caption:'Name', width:'15em' },
			      { name:'description', caption:'Description' } ],
			    function( id ) { closeView(); viewMeeting( id ); } );

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container' })
		// .append($('<div/>', { id:'meetings' })
		// 	.append($('<p/>', { text:'Fetching meetings...' }))
		//        )
		.append( $list )
		// .append($('<p/>', { id:'index' }))
		// .append($('<button/>', { text:'Page up', click:function(){ meetingsList.previous() }}))
		// .append($('<button/>', { text:'Page down', click:function(){ meetingsList.next() }}))
		.append($('<button/>', { text:'New meeting', click:function(){ closeView(); viewCreateMeeting() } } ))
               );

    meetingsDiv = $('#meetings');
}

function viewCreateMeeting( )
{
    var closeView = function( ) { };

    var create = function( ) {
	var name = $('#nameInput').val();
	var description = $('#descriptionInput').val();

	newMeeting( name, description, function( error ) {
	    // TODO
	});

	viewMeetings();	    
    };

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container', 'class':'inputForm' })
		.append($('<h2/>', { text:'New meeting' }))
		.append($('<label/>', { id:'nameLabel', 'for':'nameInput', text:'Name' } ))
		.append($('<br/>'))
		.append($('<input/>', { id:'nameInput' } ))
		.append($('<br/>'))
		.append($('<label/>', { id:'descriptionLabel', 'for':'descriptionInput', text:'Description' } ))
		.append($('<br/>'))
		.append($('<input/>', { id:'descriptionInput' } ))
		.append($('<br/>'))
		.append($('<button/>', { text:'Create', click:function(){ closeView(); create() } } ))
               );
}

function viewMeeting( meeting )
{
    var meetingNode;

    var threadsList;

    var threadsDiv;

    var closeView = function( ) {
	meetingNode.close();
	threadsList.close();
    };

    var meetingCallback = function( node ) {
	// Redundancy: node == meetingNode;
	var item = node.item();
	$('#meetingHeading').text("Meeting " + item.name);
	$('#meetingDescription').text(item.description);
    }

    var threadsCallback = function( list ) {
	// Redundancy: list == threadsList
	var threads = list.items();
	threadsDiv.empty();
	for (var i=0; i < threads.length; i++)
	{
	    var thread = threads[i];
	    var view = function( thread ) { return function() {
		viewThread( thread );
	    }};
	    var cssClass = 'thread ' + (list.selectedId() == thread.id ? 'selected' : 'no-selected');
	    threadsDiv.append($('<div/>', { click:view( thread ),
					    'class':cssClass } )
			      .append($('<p/>', { text:thread.subject, 'class':'subject' } ))
			     );
	}
	$('#index').text((list.offset() + 1) + '-' + (list.offset() + list.items().length) + ' of ' + list.size());
    }

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container' })
		.append($('<h2/>', { text:'Meeting', id:'meetingHeading' }))
		.append($('<p/>', { id:'meetingDescription' }))
		.append($('<ul/>', { id:'threads' })
			.append($('<li/>', { text:'Fetching threads...' }))
		       )
		.append($('<p/>', { id:'index' }))
		.append($('<button/>', { text:'Page up', click:function(){ threadsList.previous() }}))
		.append($('<button/>', { text:'Page down', click:function(){ threadsList.next() }}))
		.append($('<button/>', { text:'New thread',
					 click:function(){ closeView(); viewCreateThread( meetingNode.item() ) } } ))
               );

    meetingNode = liveDb.get( meeting, { 'name':1, 'description':1 }, meetingCallback );

    threadsList = liveDb.list( threadsCallback, meeting, '->', null, { 'subject':1 },
			       5, null, null, [ { name:'subject', dir:'asc', nocase:1 } ] );

    threadsDiv = $('#threads');
}


function viewCreateThread( meeting )
{
    var closeView = function( ) { };

    var create = function( ) {
	var subject = $('#subjectInput').val();
	var firstMessage = $('#contentsInput').val();

	newThread( meeting, subject, firstMessage, function( error ) {
	    // TODO
	});

	viewMeeting( meeting );
    };

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container', 'class':'inputForm' })
		.append($('<h2/>', { text:'New thread' }))
		.append($('<label/>', { id:'subjectLabel', 'for':'subjectInput', text:'Subject' } ))
		.append($('<br/>'))
		.append($('<input/>', { id:'subjectInput' } ))
		.append($('<br/>'))
		.append($('<label/>', { id:'contentsLabel', 'for':'contentsInput', text:'Contents' } ))
		.append($('<br/>'))
		.append($('<textarea/>', { id:'contentsInput' } ))
		.append($('<br/>'))
		.append($('<button/>', { text:'Create', click:function(){ closeView(); create() } } ))
               );
}

function viewThread( thread )
{
    var threadNode;

    var messagesList;

    var messagesContainer;

    var closeView = function( ) {
	threadNode.close();
	messagesList.close();
    };

    var threadCallback = function( node ) {
	// Redundancy: node == threadNode;
	var item = node.item();
	$('#threadSubject').text(item.subject);
    }

    var messagesCallback = function( list ) {
	// Redundancy: list == messagesList
	var messages = list.items();
	messagesContainer.empty();
	for (var i=0; i < messages.length; i++)
	{
	    var message = messages[i];
	    var comment = function( m ) { return function () {
		viewCreateMessage( threadNode.item(), m );
	    }};
            messagesContainer.append($('<div/>', { 'class':'message'
						   + (message.u_read ? ' no-unread' : ' unread')
						   + (list.selectedId() == message.id ? ' selected' : ' no-selected') })
				     .append($('<p/>', { text:message.text }))
				     .append($('<button/>', { text:'Comment', click:comment( message ) }))
				    );
	}
	$('#index').text((list.offset() + 1) + '-' + (list.offset() + list.items().length) + ' of ' + list.size());
    }

    root.empty();
    root.append($('<h1/>', { text:'Forum' }))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container' })
		.append($('<h2/>', { text:'Thread', id:'threadHeading' }))
		.append($('<h3/>', { id:'threadSubject' }))
		.append($('<div/>', { id:'messages' })
			.append($('<p/>', { text:'Fetching messages...' }))
		       )
		.append($('<p/>', { id:'index' }))
		.append($('<button/>', { text:'Page up', click:function(){ messagesList.previous() }}))
		.append($('<button/>', { text:'Page down', click:function(){ messagesList.next() }}))
		.append($('<button/>', { text:'Previous unread', click:function(){ messagesList.previousSelected() }}))
		.append($('<button/>', { text:'Next unread', click:function(){ messagesList.nextSelected() }}))
		.append($('<button/>', { text:'New message',
					 click:function(){ closeView(); viewCreateMessage( threadNode.item(), null ) }}))
               );

    threadNode = liveDb.get( thread, { 'subject':1 }, threadCallback );

    messagesList = liveDb.list( messagesCallback, thread, '->', null, { 'text':1, 'name':1, 'u_read':1 },
				5, null, 'u_read', [ { name:'text', dir:'asc' }, { name:'name', dir:'asc' } ] );

    messagesContainer = $('#messages');
}

function viewCreateMessage( thread, commentTo )
{
    var closeView = function( ) { };

    var create = function( ) {
	var message = $('#textInput').val();

	newMessage( thread, commentTo, message, function ( error ) {
	    // TODO
	});

	viewThread( thread );
    };

    root.empty();
    root.append($('<h1/>', { text:'Forum' } ))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container', 'class':'inputForm' })
		.append($('<h2/>', { text:'New message' } ))
		.append($('<label/>', { id:'textLabel', 'for':'textInput', text:'Message' } ))
		.append($('<br/>'))
		.append($('<textarea/>', { id:'textInput' } ))
		.append($('<br/>'))
		.append($('<button/>', { text:'Create', click:function(){ closeView(); create() } } ))
               );
}

function newMeeting( name, description, callback )
{
    var trans = liveDb.transaction();

    trans.create( '/meetings/', { 'name': name, 'description': description } );
    trans.go( callback );
}

function newThread( meeting, subject, firstMessage, callback )
{
    var trans = liveDb.transaction();
    var thread;

    thread = trans.create( meeting, { 'subject': subject } );
    trans.create( thread, { 'text': firstMessage } );
    trans.go( callback );
}

function newMessage( thread, commentTo, message, callback )
{
    var trans = liveDb.transaction();
    var newMessage;

    newMessage = trans.create( thread, { 'text': message } );
    if (commentTo)
    {
	trans.addRelationship( commentTo, newMessage, 'comment', true );
    }
    trans.go( callback );
}

function createList( id, list, columns, click )
{
    var $container = $('<div/>', { id: id, 'class': 'list' } );

    var $header = $('<div/>', { 'class':'header' });
    var $contents = $('<div/>', { id: id+'_contents', 'class':'contents' });
    var $footer = $('<div/>', { 'class':'footer' });

    $container.data( 'columns', columns );
    $container.data( 'click', click );

    for (var i = 0; i < columns.length; i++)
    {
	var column = columns[i];
	var style = (column.width ? 'width:'+column.width+';' : '');
	$header.append($('<span/>', { text: column.caption, style: style, 'class': 'column' }));
    }

    $footer
	.append($('<button/>', { text:'Page up', click:function(){ list.previous() }}))
	.append($('<button/>', { text:'Page down', click:function(){ list.next() }}))

    $container
	.append($header)
	.append($contents)
	.append($footer);

    return $container;
}

function updateList( id, items )
{
    var $container = $('#'+id);
    var $contents = $('#'+id+'_contents');

    var columns = $container.data( 'columns' );
    var click = $container.data( 'click' );

    $contents.empty();

    for (var i = 0; i < items.length; i++)
    {
	var item = items[i];

	var itemClick = function( id ){ return function( e ) {
	    click( id );
	} };

	var $row = $('<div/>', { 'class': 'item', click: itemClick( item.id ) });

	for (var j = 0; j < columns.length; j++)
	{
	    var column = columns[j];

	    var style = (column.width ? 'width:'+column.width+';' : '');

	    $row.append($('<span/>', { text: item[ column.name ], style: style, 'class':'detail' }));
	}

	$contents.append( $row );
    }
}

function createMenu( id, items, mobile )
{
    var $container = $('<ul/>', { id: id, 'class': 'menu' } );

    for (var i = 0; i < items.length; i++)
    {
	var item = items[i];

	var itemClass = mobile ? '' : 'horizontal';

	$container.append(
	    $('<li/>', { 'class': itemClass, click:item.click }).append(
		$('<a/>', { text: item.caption })
	    )
	);
    }

    return $container;
}

