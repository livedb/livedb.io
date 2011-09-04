var liveDb;
var root;

var usersDiv;
var meetingsDiv;
var messagesDiv;

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
    return $('<ul></ul>').attr('id', 'nav')
	.append($('<li/>', { text:'Users', click:function(){ closeView(); viewUsers(); }, addClass:'clickable' }))
	.append($('<li></li>').text('Meetings').click(function(){ closeView(); viewMeetings(); }));
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
	var users = usersList.items();
	usersDiv.empty();
	for (var i=0; i < users.length; i++)
	{
            usersDiv.append($('<p/>', { text:users[i].name + ' ('+users[i]._online+')',
					addClass:usersList.selectedId() == users[i].id ? 'selected' : 'no-selected' } ));
	}
    };

    root.empty();
    root.append($('<h1></h1>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div></div>').attr('id', 'container')
		.append($('<h2></h2>').text('Users'))
		.append($('<div></div>').attr('id', 'users')
			.append($('<p></p>').text('Fetching users...'))
		       )
		.append($('<button></button>').text('Page up').click(function(){ usersList.previous() }))
		.append($('<button></button>').text('Page down').click(function(){ usersList.next() }))
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
	// Redundancy: list == meetingsList
	var meetings = list.items();
	meetingsDiv.empty();
	for (var i=0; i < meetings.length; i++)
	{
	    var meeting = meetings[i];
            meetingsDiv.append($('<p/>', { text:meetings[i].subject, click:function(){ viewMeeting( meeting ) } }));
	}
    };

    root.empty();
    root.append($('<h1></h1>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div></div>').attr('id', 'container')
		.append($('<h2></h2>').text('Meetings'))
		.append($('<div></div>').attr('id', 'meetings')
			.append($('<p></p>').text('Fetching meetings...'))
		       )
		.append($('<button></button>').text('Page up').click(function(){ meetingsList.previous() }))
		.append($('<button></button>').text('Page down').click(function(){ meetingsList.next() }))
		.append($('<button/>', { text:'New meeting', click:function(){ closeView(); viewCreateMeeting() } } ))
               );

    meetingsList = liveDb.list( meetingsCallback, '/meetings', '->', null, { 'subject':1 },
				5, null, null, [ { name:'_online', dir:'desc' } ] );

    meetingsDiv = $('#meetings');
}

function viewCreateMeeting( )
{
    var closeView = function( ) { };

    var create = function( ) {
	var name = $('#nameInput').val();
	var description = $('#descriptionInput').val();
	newMeeting( name, description, function( res, error) {
	    viewMeetings();	    
	});
    };

    root.empty();
    root.append($('<h1></h1>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>', { id:'container' })
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
	$('#meetingHeading').text('Meeting ' + item.subject);
    }

    var threadsCallback = function( list ) {
	// Redundancy: list == threadsList
	var threads = list.items();
	threadsDiv.empty();
	for (var i=0; i < threads.length; i++)
	{
	    var thread = threads[i];
            threadsDiv.append($('<p/>', { text:thread.subject, click:function(){ viewThread( thread ) } }));
	}
    }

    root.empty();
    root.append($('<h1/>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>').attr('id', 'container')
		.append($('<h2/>', { text:'Meeting', id:'meetingHeading' }))
		.append($('<ul/>').attr('id', 'threads')
			.append($('<li></li>').text('Fetching threads...'))
		       )
		.append($('<button/>').text('Page up').click(function(){ threadsList.previous() }))
		.append($('<button/>').text('Page down').click(function(){ threadsList.next() }))
		.append($('<button/>', { text:'New thread',
					 click:function(){ closeView(); viewCreateThread( meetingNode.item() ) } } ))
               );

    meetingNode = liveDb.get( meeting, { 'subject':1 }, meetingCallback );

    threadsList = liveDb.list( threadsCallback, meeting, '->', null, { 'subject':1 },
			       5, null, null, [ { name:'subject', dir:'asc', nocase:1 } ] );

    threadsDiv = $('#threads');
}

function viewCreateThread( meeting ) {
    var closeView = function( ) { };

    var create = function( ) {
	var subject = $('#subjectInput').val();
	var firstMessage = $('#contentsInput').val();

	newThread( meeting, subject, firstMessage, function( res, error ) {
	    viewMeeting( meeting );
	});
    };

    root.empty();
    root.append($('<h1/>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>').attr('id', 'container')
		.append($('<h2/>').text('New thread'))
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
            messagesContainer.append($('<div/>', { addClass: message.u_read ? 'no-unread' : 'unread' })
				     .append($('<p/>', { text:message.author+' says:' }))
				     .append($('<p/>', { text:message.contents }))
				     .append($('<button/>', { text:'Comment',
							      click:{ closeView();
								      viewCreateMessage(threadNode.item(), message) }}))
				    );
	}
    }

    root.empty();
    root.append($('<h1/>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>').attr('id', 'container')
		.append($('<h2/>', { text:'Thread', id:'threadHeading' }))
		.append($('<h3/>', { id:'threadSubject' }))
		.append($('<div/>', { id:'messages' })
			.append($('<p/>', { text:'Fetching messages...' }))
		       )
		.append($('<button/>', { text:'Page up', click:function(){ messagesList.previous() }}))
		.append($('<button/>', { text:'Page down', click:function(){ messagesList.next() }}))
		.append($('<button/>', { text:'Previous unread', click:function(){ messagesList.previousSelected() }}))
		.append($('<button/>', { text:'Next unread', click:function(){ messagesList.nextSelected() }}))
		.append($('<button/>', { text:'New message',
					 click:function(){ closeView(); viewCreateMessage( threadNode.item(), null ) }}))
               );

    threadNode = liveDb.get( thread, { 'subject':1 }, threadCallback );

    messagesList = liveDb.list( messagesCallback, thread, '->', null, { 'author':1, 'contents':1, 'time':1, 'u_read':1 },
				5, null, 'u_read', [ { name:'time', dir:'asc' },
						     { name:'author', dir:'asc', nocase:1 } ] );

    messagesContainer = $('#messages');
}

function viewCreateMessage( thread, commentTo ) {
    var closeView = function( ) { };

    var create = function( ) {
	var message = $('#contentsInput').val();

	newMessage( thread, commentTo, message, function ( res, error ) {
	    viewThread( thread );
	});
    };

    root.empty();
    root.append($('<h1/>').text('Forum'))
	.append(partialViewNavigation( closeView ))
        .append($('<div/>').attr('id', 'container')
		.append($('<h2/>').text('New message'))
		.append($('<label/>', { id:'contentsLabel', 'for':'contentsInput', text:'Contents' } ))
		.append($('<br/>'))
		.append($('<textarea/>', { id:'contentsInput' } ))
		.append($('<br/>'))
		.append($('<button/>', { text:'Create', click:function(){ closeView(); create() } } ))
               );
}

function newMeeting( name, description, callback )
{
    var trans = liveDb.transaction();

    trans.create( '/messages/', { 'name': name, 'description': description } );
    trans.go( callback );
}

function newThread( meeting, subject, firstMessage, callback )
{
    var trans = liveDb.transaction();
    var thread;

    thread = trans.create( meeting, { 'name': subject } );
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
