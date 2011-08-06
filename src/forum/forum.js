var liveDb;
var root;

var usersDiv;
var messagesDiv;

var usersList;

function onLoad( _liveDb, _rootId )
{
    liveDb = _liveDb;
    root = $('#'+_rootId);
    
    root.empty();
    root.append($('<h1></h1>').text('Forum'))
        .append($('<div></div>').attr('id', 'userContainer')
            .append($('<h2></h2>').text('Users'))
	    .append($('<button></button>').text('Prev').click(function(){ usersList.previousSelected() }))
	    .append($('<button></button>').text('Next').click(function(){ usersList.nextSelected() }))
	    .append($('<button></button>').text('First').click(function(){ usersList.first() }))
	    .append($('<button></button>').text('Last').click(function(){ usersList.last() }))
            .append($('<div></div>').attr('id', 'users')
                .append($('<p></p>').text('Fetching users...'))

            )
	    .append($('<button></button>').text('Page up').click(function(){ usersList.previous() }))
	    .append($('<button></button>').text('Page down').click(function(){ usersList.next() }))
        )
        .append($('<div></div>').attr('id', 'messageContainer')
            .append($('<h2></h2>').text('Messages'))
            .append($('<div></div>').attr('id', 'messages')
                .append($('<p></p>').text('Fetching messages...'))
            )
            .append($('<textarea></textarea>')
                .attr({
                    'id': 'message',
                    'rows': '5',
                    'cols': '80'
                })
            )
            .append($('<br>'))
            .append($('<button></button>').click(post).text('New Message'))
        );

    usersDiv = $('#users');
    messagesDiv = $('#messages');
    
    usersList = liveDb.list( usersCallback, '/users', '->', null, { 'name' : 1 , '_online' : 1 },
			     5, null, '_online', [ /*{ name:'_online', dir:'desc' },*/
				 { name:'name', dir:'asc', nocase:1 } ] );

    liveDb.list( messagesCallback, '/messages', '->', null, { 'text' : 1, 'u_read' : 1,
							      // 'date' : 1,
							      // 'author' ; { 'name' : 1 }
							    },
		 15, null, null, null );

    liveDb.get( '/messages', {}, messagesObjCallback );
}

function usersCallback( users )
{
    usersDiv.empty();
    for (var i=0; i < users.length; i++)
    {
        usersDiv.append($('<p></p>').text(users[i].name + ' ('+users[i]._online+')')
			.addClass( usersList.selectedId() == users[i].id ? 'selected' : 'no-selected' ));
    }
}

function messagesCallback( messages )
{
  messagesDiv.empty();
  
  for (var i=0; i < messages.length; i++)
      messagesDiv//.append($('<p></p>').text('Posted by '+messages[i].author[0].name+' on '+messages[i].date))
                 .append($('<p></p>').text(messages[i].text));
}

var messagesObj;

function messagesObjCallback( _messagesObj )
{
    messagesObj = _messagesObj;
}

function post(e)
{
    var trans = liveDb.transaction();

    trans.create( messagesObj, { 'text' : $('#message').val() }, null );
    trans.go( null );
    $('#message').val( '' );
}
