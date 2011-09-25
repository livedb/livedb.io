var fs = require('fs');
var assert = require('assert');
var lowLevelDb = require( './LowLevelDb' );
var attrParser = require( './attrParser' );

var attrParser = require( './attrParser' );
var condParser = require( './condParser' );
var fragment = require( './sqlFragment' );

var relationship_limit = 10;

DatabaseManager = function (server, dbPath, callback)
{
    this._clientIds = {};
    this._subscriptions = {};

    this._lists = {};
    this._nodes = {};
    this._userOnline = {};
    
    this._clientMethods =
    {
        'login':       this._clientLogin,
	'logout':      this._clientLogout,
        'transaction': this._clientTransaction,
	'userRead':    this._clientUserRead,
	'get':         this._clientGet,
	'list':        this._clientList,
	'moveList':    this._clientMoveList,
	'closeNode':   this._clientCloseNode,
	'closeList':   this._clientCloseList,
	'tree':        this._clientTree,
    };

    var self = this;
    this._openDatabase( dbPath, function(error)
			{
			    if (!error && server)
				self._io = self._setupSocket( server );
			    callback( error );
			} );
};

DatabaseManager.prototype =
{
    _setupSocket: function (server)
    {
        var io = require('socket.io').listen( server/*, { resource: 'db' }*/ );
        var self = this;
        io.sockets.on( 'connection', function (clientSocket){
            clientSocket.on( 'message', function (message, callback){
                self._handleMessage.call(self, clientSocket, message /*, callback*/);
            });
            clientSocket.on( 'disconnect', function(){
                self._clientDisconnect.call(self, clientSocket);
            });
            self._addClient.call(self, clientSocket);
        });
        return io;
    },
    
    _addClient: function (client)
    {
        this._subscriptions[ client.id ] = {};
        this._lists[ client.id ] = {};
	this._nodes[ client.id ] = {};
    },
    
    _handleMessage: function (client, message /*, callback*/)
    {
        if (( 'method' in message ) && ( message.method in this._clientMethods ))
        {
            var method = message.method;
            this._clientMethods[method].call(this, client, message /*, callback*/);
        }
    },
    
    _clientDisconnect: function (client)
    {
	var self = this;
	var clientId = this._clientIds[ client.id ];

        delete self._subscriptions[ client.id ];
        delete self._clientIds[ client.id ];
	delete self._lists[ client.id ];
        this._setUserOnline(clientId, false, function (){
            // Tell subscribers that this client is now offline
            self._broadcastLogin(client);
        });
    },

    _clientGet: function (client, message)
    {
	if (( 'nodeId' in message ) &&
	    ( 'attr' in message ) &&
	    ( 'id' in message ))
	{
            var sid = message.id;
	    var user = client;
	    var self = this;
	    assert.ok( client.id && '' + client.id != 'undefined' );
	    var nodes = self._nodes[ client.id ];
	    nodes[ sid ] = message;

	    this.get( message.nodeId, message.attr, user, function (error, res) {
		if (error)
		{
		    throw error;
		}
		else
		{
		    var packet = self._createPacket( sid, res );
		    client.json.send( packet );
		}
	    } );
	}
    },

    _clientList: function (client, message)
    {
        if (( 'parent' in message ) &&
            ( 'relationship' in message ) &&
            ( 'searchQuery' in message ) &&
            ( 'attributeSpec' in message ) &&
            ( 'windowSize' in message ) &&
            ( 'windowStart' in message ) &&
            ( 'extraCondition' in message ) &&
            ( 'orderColumns' in message ) &&
            ( 'id' in message ))
        {
	    var self = this;
            var sid = message.id;
	    var clientId = this._getClientId( client );

	    assert.ok( client.id && '' + client.id != 'undefined' );
	    var lists = self._lists[ client.id ];

	    var inner = function (error, list)
	    {
		// console.log("LIST PARENT ID " + list.parentId);
		// console.log(list);
		if (error)
		{
		    console.log( error );
		    throw error;
		}
		lists[ sid ] = list;
		self._execList( list, function (error, list, properties) {
		    if (error)
		    {
			console.log( error );
			throw error;
		    }
		    var packet = self._createPacket( sid, { list:list, properties:properties } );
		    client.json.send( packet );
		} );
	    };

	    this._createList( message.parent, message.relationship, message.searchQuery,
	    		      message.attributeSpec, message.windowSize, message.windowStart,
	    		      message.extraCondition, message.orderColumns, clientId, inner );
        }
    },

    _clientMoveList: function (client, message)
    {
        if (( 'movement' in message ) &&
            ( 'id' in message ) &&
	    ( client.id in this._lists ) &&
	    ( message.id in this._lists[ client.id ] ))
        {
	    var self = this;
            var sid = message.id;
	    var movement = message.movement;
            var list = this._lists[ client.id ][ sid ];

	    var innerMove = function (windowStart) {
		list.windowStart = windowStart;

		self._execList( list, function (error, res, properties) {
		    if (error)
			throw error;
		    var packet = self._createPacket( sid, { list:res, properties:properties } );
		    client.json.send( packet );
		} );
	    };

	    var tryFindWithinCache = function (origin, forward) {
		var nextIndex = null;
		var nextId = null;
		if (origin < list.cacheBegin || origin >= list.cacheEnd)
		{
		    return false;
		}
		else
		{
		    if (forward)
		    {
			for (var i = origin; i < list.cacheEnd; i++)
			{
			    var cacheIndex = i - list.cacheBegin;
			    if (list.cache[ cacheIndex ].extraCondition)
			    {
				nextIndex = i;
				nextId = list.cache[ cacheIndex ].id;
				break;
			    }
			}
		    }
		    else
		    {
			for (var i = origin; i >= list.cacheBegin; i--)
			{
			    var cacheIndex = i - list.cacheBegin;
			    if (list.cache[ cacheIndex ].extraCondition)
			    {
				nextIndex = i;
				nextId = list.cache[ cacheIndex ].id;
				break;
			    }
			}
		    }
		    if (nextIndex !== null)
		    {
			// Still inside the cache
			list.selectedIndex = nextIndex;
			list.selectedId = nextId;
			if (nextIndex >= list.windowStart && nextIndex < list.windowStart + list.windowSize)
			{
			    // Stay within the current window
			    innerMove( list.windowStart );
			}
			else
			{
			    innerMove( Math.max( 0, nextIndex - ( list.windowSize >> 1 ) ) );
			}
			return true;
		    }
		    else
		    {
			return false;
		    }
		}
	    };

	    var innerSelectAndMove = function (error, index, id) {
		if (error)
		    throw error;
		if (index !== null)
		{
		    list.selectedIndex = index;
		    list.selectedId = id;
		    if (index >= list.windowStart && index < list.windowStart + list.windowSize)
			innerMove( list.windowStart );
		    else
			innerMove( Math.max( 0, index - ( list.windowSize >> 1 ) ) );
		}
		else
		{
		    // Found no matching nodes
		}
	    };

	    var innerMoveFirst = function (forward) {
		if (!tryFindWithinCache( forward ? 0 : list.count - 1, forward ))
		{
		    self._listGetFirstSelectedNode( list, forward, innerSelectAndMove );
		}
	    }

	    var innerMoveNext = function (forward) {
		if (!tryFindWithinCache( list.selectedIndex + ( forward ? 1 : -1 ), forward ))
		{
		    self._listGetNextSelectedNode( list, forward, innerSelectAndMove );
		}
	    };

	    switch (movement)
	    {
	    case 'to':
		if ( 'windowStart' in message )
		    innerMove( message.windowStart );
		break;

	    case 'nextSelected':
		if (list.selectedIndex === null)
		    innerMoveFirst( true )
		else
		    innerMoveNext( true );
		break;

	    case 'previousSelected':
		if (list.selectedIndex === null)
		    innerMoveFirst( false );
		else
		    innerMoveNext( false );
		break;

	    case 'first':
		innerMoveFirst( true );
		break;

	    case 'last':
		innerMoveFirst( false );
		break;
	    }
        }
    },

    _clientCloseNode: function (client, message)
    {
        if (( 'id' in message ))
        {
            var sid = message.id;
            var nodes = this._nodes[ client.id ];
            delete nodes[ sid ];
        }
    },

    _clientCloseList: function (client, message)
    {
        if (( 'id' in message ))
        {
            var sid = message.id;
            var lists = this._lists[ client.id ];
            delete lists[ sid ];
        }
    },
    
    _clientLogin: function (client, message)
    {
	var self = this;

        if (( 'name' in message ) && ( 'id' in message ))
        {
            self._getOrCreateUser(message.name, function (user) {
                self._setClientId( client, user.id );
                self._setUserOnline( user.id, true, function () {
                    client.json.send( { result: 'success', id: message.id } );
                    // Tell subscribers that this client is now online
                    self._broadcastLogin( client );
                } );
            } );
        }
    },
    
    _clientTransaction: function (client, message)
    {
	if ( 'id' in message && 'transaction' in message ) {
	    var transaction = message.transaction;
	    var userId = this._getClientId( client )

	    transaction.user = userId; // ???

	    var self = this;

	    this.runTransaction( transaction, 0, function (error) {
		if (error)
		{
		    var packet = self._createPacket( message.id, error );
		    client.json.send( packet );

		    console.log( error );
		    throw error;
		}
		else
		{
		    var packet = self._createPacket( message.id, null );
		    client.json.send( packet );
		}
	    } );
	}
    },
 
    _clientUserRead: function (client, message)
    {
	if ( 'node_id' in message && 'node_revision' in message ) {

            var sql = "INSERT INTO user_read (user, node_id, node_revision, timestamp) VALUES (?, ?, ?, DATETIME('NOW'))";

	    var conn = this._db.connection();

	    conn.start( true );
	    conn.insert( sql, [ this._getClientId( client ), message.node_id, message.node_revision ] );
	    conn.go( function (error, res) {
		conn.close();
	    } );
	}
    },
    
    _setUserOnline: function (userId, isOnline, callback)
    {
	var self = this;
	var conn = this._db.connection();

	if (isOnline)
	    this._userOnline[ userId ] = 1;
	else
	    delete this._userOnline[ userId ];

	conn.start( true );

	conn.exec( "INSERT OR REPLACE INTO user_online (user, online) VALUES (?, ?)",
	 	   [ userId, isOnline ? 1 : 0 ] );
	conn.commit();

	conn.go( function (error, res) {
	    if (error) throw error;

	    conn.close();

	    callback();

	    self._invalidateAllLists();
	} );
    },
    
    _createPacket: function (sid, data)
    {
        var packet = { id: sid, result: data };
        return packet;
    },
    
    _broadcastLogin: function (client)
    {
        userId = this._getClientId( client );
        this._getUsers( function (users){
            this._broadcast( "users", users );
        }, userId);
    },
    
    _broadcast: function (type, data)
    {
    },
    
    _getClientId: function (client)
    {
        return this._clientIds[ client.id ];
    },
    
    _setClientId: function (client, userId)
    {
        this._clientIds[ client.id ] = userId;
    },
    
    _fastGetList: function (nodeList, attributeSpec, user, properties, callback)
    {
	var self = this;

	var resList = [];

	var innerGet = function( index ) {

	    var end = index == nodeList.length;

	    if (end)
	    {
		callback( null, resList, properties );
	    }
	    else
	    {
		self.get( nodeList[ index ].id, attributeSpec, user, function (error, res) {

		    if (error)
		    {
			callback( error );
			return;
		    }

		    if (nodeList[ index ].extraCondition !== undefined)
		    {
			res.extraCondition = nodeList[ index ].extraCondition;
		    }

		    resList.push( res );

		    innerGet( index + 1 );
		});
	    }
	};

	innerGet( 0 );
    },

    _getList: function (parent, relationship, searchQuery,
			attributeSpec, windowSize, windowStart,
			extraCondition, orderColumns, user, callback)
    {
	console.log( "*** Get list ***" );
	var self = this;
	var parentId;
	var conn = this._db.connection();

	/* Compile SQL fragments from the relationship string */

	var fromString = "";
	var joinString = "";
	var whereString = "";

	if (relationship == null || relationship == "->") {
	    fromString = "FROM node";
	    whereString = " WHERE node.parent=? AND node.active=1";
	}
	else if (relationship == "<-") {
	    fromString = "FROM node AS childNode";
	    joinString = "JOIN node node ON node.id=childNode.parent AND node.active=1";
	    whereString = " WHERE childNode.id=? AND childNode.active=1";
	}
	else if (startsWith( relationship, "->") ) {
	    var relName = relationship.substring( 2 );

	    fromString = "FROM node AS fromNode";
	    joinString = "JOIN relationship rel ON rel.from_id=fromNode.id and rel.name='" + relName + "' AND rel.active=1"
		+ "JOIN node node ON rel.to_id=node.id AND node.active=1";
	    whereString = " WHERE fromNode.id=? AND fromNode.active=1";
	}
	else if (startsWith( relationship, "<-") ) {
	    var relName = relationship.substring( 2 );

	    fromString = "FROM node AS toNode";
	    joinString = "JOIN relationship rel ON rel.from_id=node.id AND rel.name='" + relname + "' AND rel.active=1"
		+ " JOIN node node ON rel.to_id=toNode.id AND node.active=1";
	    whereString = " WHERE toNode.id=? AND toNode.active=1";
	}
	else {
	    callback( new Error("Unrecognized relationship format") );
	}

	/* Merge all attributes that will require joins */

	var allAttrs = {};
	var orderAttrs = {};

	if (orderColumns)
	{
	    for (var i in orderColumns)
	    {
		var attr = orderColumns[ i ].name;
		allAttrs[ attr ] = 1;
		orderAttrs[ attr ] = 1;
	    }
	}

	var cond = null;
	if (searchQuery)
	{
	    cond = condParser.parsePrepared( searchQuery, user );
	    for (var attr in cond.attributes)
		allAttrs[ attr ] = 1;
	}

	var extraCond = null;
	if (extraCondition)
	{
	    extraCond = condParser.parsePrepared( extraCondition, user );
	    for (var attr in extraCond.attributes)
		allAttrs[ attr ] = 1;
	}
	var attrJoins = condParser.formatSqlJoins( allAttrs, "node", user );
	
	/* Misc. helper functions */

	var formatAttribute = function (attr) {
	    if (attr == 'u_read')
		return "(u_read.user IS NOT NULL)"
	    else if (attr == '_online')
		return "(user_online.online=1)";
	    else
		return "[a_" + attr + "].value";
	};
	var createOrderByString = function (columns) {
	    var formattedColumns = [];
	    for (var i in columns)
	    {
		var col = columns[ i ];
		var dir = col.nocase ? " COLLATE NOCASE" : "";
		if (col.dir == 'desc')
		    dir += " DESC";
		else if (!col.dir || col.dir == 'asc')
		    dir += " ASC";
		else
		    throw new Error( "Unknown direction '" + col.dir + "'");
		formattedColumns.push( formatAttribute( col.name ) + dir );
	    }
	    return formattedColumns.join( ", " );
	};
	var createOrderConditionChain = function (node) {
	    var parameters = [];

	    var innerCreate = function (index) {
		var thisAttr = orderColumns[ index ];
		var thisName = thisAttr.name;
		var thisFormattedName = formatAttribute( thisName );
		var link = thisFormattedName
		    + ( thisAttr.dir == 'desc' ? '>' : '<' ) + "?"
		    + ( thisAttr.nocase ? " COLLATE NOCASE" : "" );
		parameters.push( node[ thisName ] );

		if (index == orderColumns.length - 1)
		    return link;
		else
		{
		    parameters.push( node[ thisName ] );
		    return link + " OR (" + thisFormattedName + "==?"
			+ ( thisAttr.nocase ? " COLLATE NOCASE" : "" )
			+ " AND " + innerCreate( index + 1 ) + ")";
		}
	    };

	    return { condition: innerCreate( 0 ), parameters: parameters };
	};

	/* Main helper functions */

	var resolveFirstExtraConditionNodeId = function ( ) {

	    var parameters =
		[ parentId ]
		.concat( searchQuery ? condition.parameters : [] )
		.concat( extraCond.parameters );

	    var sql = "SELECT node.id " + fromString
		+ joinString + " " + attrJoins
		+ whereString
		+ ( searchQuery ? " AND " + cond.queryString : "" )
		+ " AND " + extraCond.queryString
		+ ( orderColumns ? " ORDER BY " + createOrderByString( orderColumns ) : "" )
		+ " LIMIT 1";

	    conn.query( sql, parameters );

	    conn.go( function (error, rows) {
		if (error)
		{
		    callback( error );
		}
		else if (rows[0].length == 0)
		{
		    innerGet( 0 );
		}
		else
		{
		    conn.close();

		    resolveNodeIndex( rows[0][0].id );
		}
	    } );
	};
    
	var resolveNodeIndex = function ( id ) {
	    self.get( id, orderAttrs, user, function (error, res) {
		if (error)
		{
		    callback( error );
		    return;
		}

		conn.start( false );

		var orderCond = createOrderConditionChain( res );

		var parameters = [ parentId ]
		    .concat( searchQuery ? cond.parameters : [] )
		    .concat( orderCond.parameters );

		var sql = "SELECT count(node.id) AS count " + fromString
		    + joinString + " " + attrJoins
		    + whereString
		    + ( searchQuery ? " AND " + cond.queryString : "" )
		    + " AND " + orderCond.condition;

		conn.query( sql, parameters );

		conn.go( function (error, rows) {
		    if (error)
		    {
			callback( error );
			return;
		    }
		    innerGet( rows[0][0].count );
		} );
	    } );
	};

	var innerGet = function( startIndex ) {

	    var parameters  =
		( extraCondition ? extraCond.parameters : [] )
		.concat( [ parentId ] )
		.concat( searchQuery ? cond.parameters : [] )
		.concat( windowSize ? [ startIndex, windowSize ] : [] );

	    var sql = "SELECT node.id "
		+ ( extraCondition ? ", " + extraCond.queryString + " AS extraCondition " : "" )
		+ fromString
		+ joinString + " " + attrJoins
		+ whereString
		+ ( searchQuery ? " AND " + cond.queryString : "" )
		+ ( orderColumns ? " ORDER BY " + createOrderByString( orderColumns ) : "" )
		+ ( windowSize ? " LIMIT ?, ?" : "" );

	    conn.query( sql, parameters );

	    var countSql = "SELECT count(node.id) AS count "
		+ fromString
		+ joinString + " " + attrJoins
		+ whereString
		+ ( searchQuery ? " AND " + cond.queryString : "" );

	    conn.query( countSql, [ parentId ].concat( searchQuery ? cond.parameters : [] ) );

	    if (extraCondition)
	    {
		conn.query( "SELECT count(node.id) AS extraCount "
			    + fromString
			    + joinString + " " + attrJoins
			    + whereString
			    + ( searchQuery ? " AND " + cond.queryString : "" )
			    + " AND " + extraCond.queryString,
			    [ parentId ]
			    .concat( searchQuery ? cond.parameters : [] )
			    .concat( extraCond.parameters ) );
	    }

	    conn.go( function (error, rows) {
		if (error)
		{
		    callback( error );
		}
		else
		{
		    var idList = [];

		    var count = rows[1][0].count;
		    var extraCount = 0;

		    if (extraCondition)
			extraCount = rows[2][0].extraCount;

		    for (var i in rows[0]) {
			var node = { id: rows[0][i].id };
			
			if (extraCondition)
			{
			    node.extraCondition = rows[0][i].extraCondition;
			}

			idList.push( node );
		    }

		    conn.close();

		    var properties = { count:count, extraCount:extraCount,
				       windowStart:startIndex, windowSize:windowSize };

		    self._fastGetList( idList, attributeSpec, user, properties, callback );
		}
	    } );
	};

	/* Initialization code */

	var inner_init = function (error, id) {
	    if (error)
	    {
		callback( error );
		return;
	    }

	    conn.start( false );

	    parentId = id;

	    if (windowStart == null)
	    {
		if (extraCond)
		    resolveFirstExtraConditionNodeId( );
		else
		    innerGet( 0 );
	    }
	    else
	    {
		switch (typeof( windowStart ))
		{
		case 'object':
		    conn.close();
		    resolveNodeIndex( windowStart.id );
		    break;
		case 'number':
		    innerGet( windowStart );
		    break;
		default:
		    conn.close();
		    callback( new Error("Unknown object type. Parameter name: windowStart") );
		}
	    }
	};
	self._resolveId( parent, user, inner_init );
    },

    _getUsers: function (callback, specificId)
    {
        var self = this;

    	var userAttrs = {
    	    'name' : 1,
    	    '_online' : 1
    	};

        var resultHandler = function (error, users)
        {
            if (error) throw error;
            callback.call(self, users);
        };
        
        if (specificId != undefined)
        {
    	    self.get( specificId, userAttrs, 0, function (error, user) {
    		resultHandler( error, [ user ] );
    	    } );
    	}
        else
        {
    	    self._getList( '/users', null, null, userAttrs, null, null, null, null, null, resultHandler);
        }
    },

    _invalidateAllLists: function()
    {
	var self = this;
	var lists = [];
	for (var clientId in this._lists)
	{
	    for (var sid in this._lists[ clientId ])
	    {
		var socket = this._io.sockets.sockets[ clientId ];
		lists.push( { socket:socket, sid:sid, list:this._lists[ clientId ][ sid ] } );
	    }
	}

	var inner = function (index)
	{
	    lists[ index ].list.isCached = false;
	    self._execList( lists[ index ].list, function (error, list, properties) {
		if (error)
		{
		    throw error;
		}
		var packet = self._createPacket( lists[ index ].sid, { list:list, properties:properties } );

		lists[ index ].socket.json.send( packet );

		if (index < lists.length - 1)
		{
		    inner( index + 1 );
		}
	    } );
	};

	if (lists.length > 0)
	{
	    inner( 0 );
	}
    },

    _execList: function (list, callback)
    {
	var self = this;
	var conn = this._db.connection();

	var recache = false;

	var innerGet = function ()
	{
	    var properties = { count:list.count, extraCount:list.extraCount,
			       windowStart:list.windowStart, windowSize:list.windowSize,
			       selectedIndex:list.selectedIndex, selectedId:list.selectedId };
	    var windowOffset = list.windowStart - list.cacheBegin;
	    self._fastGetList( list.cache.slice( windowOffset, windowOffset + list.windowSize ),
			       list.attributeSpec, list.user, properties, callback );
	};

	if (!list.isCached)
	    recache = true;
	else
	{
	    var windowEnd = Math.min(list.windowStart + list.windowSize, list.count);
	    if (list.cacheBegin > list.windowStart || list.cacheEnd < windowEnd)
		recache = true;
	}
	if (recache)
	{
	    var minCacheSize = 1000;
	    var listCenter = list.windowStart + (list.windowSize >> 1);
	    list.isCached = true;
	    list.cacheBegin = Math.min( list.windowStart, Math.max(0, listCenter - (minCacheSize >> 1) ) );
	    list.cacheEnd = Math.max( list.cacheBegin + minCacheSize, list.windowStart + list.windowSize );
	    // console.log( "Center (" + list.windowStart +", " + list.windowSize + ") at: " + listCenter );
	    // console.log( list.windowStart );
	    // console.log( list.windowStart + list.windowSize );
	    // console.log( list.cacheBegin );
	    // console.log( list.cacheEnd );

	    conn.start( false );

	    list.selectQuery.tryBind( 'user', list.user );
	    list.selectQuery.bind( 'parent', list.parentId );
	    list.selectQuery.bind( 'windowStart', list.cacheBegin );
	    list.selectQuery.bind( 'windowSize', list.cacheEnd - list.cacheBegin );

	    //console.log( list.selectQuery.sql, list.selectQuery.parameters );

	    conn.query( list.selectQuery.sql, list.selectQuery.parameters );

	    list.countQuery.tryBind( 'user', list.user );
	    list.countQuery.bind( 'parent', list.parentId );

	    conn.query( list.countQuery.sql, list.countQuery.parameters );

	    if (list.hasExtraCondition)
	    {
		list.extraCountQuery.tryBind( 'user', list.user );
		list.extraCountQuery.bind( 'parent', list.parentId );

		conn.query( list.extraCountQuery.sql, list.extraCountQuery.parameters );
	    }

	    conn.go( function (error, res) {
		if (error)
		{
		    callback( error );
		    return;
		}
		conn.close();

		list.cache = res[0];
		list.count = res[1][0].count;
		list.cacheEnd = Math.min( list.cacheEnd, list.count );
		list.extraCount = list.hasExtraCondition ? res[2][0].count : 0;

		innerGet();
	    } );
	}
	else
	{
	    innerGet();
	}
    },

    _listGetIndexFromId: function (list, nodeId, callback)
    {
	var self = this;
	var conn = this._db.connection();

	self.get( nodeId, list.allAttrs, list.user, function (error, node) {
	    if (error)
	    {
		callback( error );
		return;
	    }

	    conn.start( false );

	    for (var attr in list.allAttrs)
		list.resolveNodeIndexQuery.tryBind( attr, node[ attr ] );

	    list.resolveNodeIndexQuery.tryBind( 'user', list.user );
	    list.resolveNodeIndexQuery.bind( 'parent', list.parentId );

	    conn.query( list.resolveNodeIndexQuery.sql, list.resolveNodeIndexQuery.parameters );

	    conn.go( function (error, nextNodeIndexRows) {
		if (error)
		{
		    callback( error );
		    return;
		}
		conn.close();
		if (nextNodeIndexRows[0].length == 0)
		{
		    callback( null, null );
		    return;
		}
		var nodeIndex = nextNodeIndexRows[0][0].count;
		callback( null, nodeIndex );
	    } );
	} );
    },

    _listGetFirstSelectedNode: function (list, forward, callback)
    {
	var self = this;
	var conn = this._db.connection();
	var query;

	conn.start( false );

	if (forward)
	    query = list.selectFirstExtraNodeQuery;
	else
	    query = list.selectLastExtraNodeQuery;

	query.tryBind( 'user', list.user );
	query.bind( 'parent', list.parentId );

	conn.query( query.sql, query.parameters );

	conn.go( function(error, firstNodeIdRows) {
	    if (error)
	    {
		throw error;
		callback( error );
		return;
	    }
	    conn.close();
	    if (firstNodeIdRows[0].length == 0)
	    {
		callback( null, null );
		return;
	    }
	    var firstNodeId = firstNodeIdRows[0][0].id;
	    self._listGetIndexFromId( list, firstNodeId, function (error, firstNodeIndex) {
		if (error)
		{
		    throw error;
		    callback( error );
		    return;
		}
		callback( null, firstNodeIndex, firstNodeId );
	    } );
	} );
    },
    
    _listGetNextSelectedNode: function (list, forward, callback)
    {
	var self = this;
	var conn = this._db.connection();
	// console.log( "=== Låtom oss navigera i en lista! ===" );
	// console.log( forward );
	// console.log( thisSelectedIndex );
	// console.log( thisSelectedId );

	self.get( list.selectedId, list.allAttrs, list.user, function (error, selectedNode) {
	    if (error)
	    {
		throw error;
		callback( error );
		return;
	    }
	    // console.log( "=== Step one done; now we have the data of the selected node ===" );
	    // for (var attr in list.allAttrs)
	    // {
	    // 	console.log( "Attribute " + attr + " for this node:" );
	    // 	console.log( selectedNode[ attr ] );
	    // }

	    conn.start( false );

	    var query;
	    if (forward)
		query = list.selectNextExtraNodeQuery;
	    else
		query = list.selectPreviousExtraNodeQuery;

	    for (var attr in list.allAttrs)
		query.tryBind( attr, selectedNode[ attr ] );
	    query.tryBind( 'user', list.user );
	    query.bind( 'parent', list.parentId );

	    // console.log( selectedNode );
	    // console.log( query );

	    conn.query( query.sql, query.parameters );

	    conn.go( function(error, nextNodeIdRows) {
		if (error)
		{
		    throw error;
		    callback( error );
		    return;
		}
		conn.close();
		if (nextNodeIdRows[0].length == 0)
		{
		    callback( null, null );
		    return;
		}
		var nextNodeId = nextNodeIdRows[0][0].id;
		self._listGetIndexFromId( list, nextNodeId, function (error, nextNodeIndex) {
		    if (error)
		    {
			throw error;
			callback( error );
			return;
		    }
		    callback( null, nextNodeIndex, nextNodeId );
		} );
	    } );
	} );
    },

    _createListQueries: function (relationship, searchQuery, extraCondition, orderColumns)
    {
	var list = {};

	// var crypto = require('crypto');
	// var hash = crypto.createHash('sha1').update(relationship+'/'+searchQuery+'/'
	// 					    +extraCondition+'/'+orderColumns).digest();
	// ...or something...
	// if (this._createdLists[ hash ])
	//     return this._createdLists[ hash ].clone();

	/* Misc. helper functions */

	var formatAttribute = function (attr) {
	    if (attr == 'u_read')
		return "(u_read.user IS NOT NULL)"
	    else if (attr == '_online')
		return "(user_online.online=1)";
	    else
		return "[a_" + attr + "].value";
	};
	var createOrderFragment = function (columns, invert) {
	    var formattedColumns = [];
	    for (var i in columns)
	    {
		var col = columns[ i ];
		var dir = col.nocase ? " COLLATE NOCASE" : "";
		if (invert ^ (col.dir == 'desc'))
		    dir += " DESC";
		else if (invert ^ (!col.dir || col.dir == 'asc'))
		    dir += " ASC";
		else
		    throw new Error( "Unknown direction '" + col.dir + "'");
		formattedColumns.push( formatAttribute( col.name ) + dir );
	    }
	    return fragment.create( formattedColumns.join( ", " ) );
	};
	var createOrderConditionFragment = function (invert) {

	    var innerCreate = function (index) {
		var thisAttr = orderColumns[ index ];
		var thisName = thisAttr.name;
		var thisFormattedName = formatAttribute( thisName );

		var f = fragment.create(thisFormattedName
					+ ( (invert ^ (thisAttr.dir == 'desc')) ? '>' : '<' ) + "?"
					+ ( thisAttr.nocase ? " COLLATE NOCASE" : "" ),
					[{ name:thisName }] );

		if (index == orderColumns.length - 1)
		    return f;
		else
		{
		    return fragment.create( '(' )
			.append( f )
			.append( "OR " + thisFormattedName + "==?"
				 + ( thisAttr.nocase ? " COLLATE NOCASE" : "" )
				 + " AND", [{ name:thisName }] )
			.append( innerCreate( index + 1 ) )
			.append( ')' );
		}
	    };

	    return innerCreate( 0 );
	};

	/* Compile SQL fragments from the relationship string */

	list.fromFragment = fragment.empty;
	list.joinFragment = fragment.empty;
	list.whereFragment = fragment.empty;

	if (relationship == null || relationship == "->") {
	    list.fromFragment = fragment.create( "FROM node" );
	    list.whereFragment = fragment.create( "WHERE node.parent=? AND node.active=1", [{name:'parent'}] );
	}
	else if (relationship == "<-") {
	    list.fromFragment = fragment.create( "FROM node AS childNode" );
	    list.joinFragment = fragment.create( "JOIN node node ON node.id=childNode.parent AND node.active=1" );
	    list.whereFragment = fragment.create( "WHERE childNode.id=? AND childNode.active=1", [{ name:'parent' }] );
	}
	else if (startsWith( relationship, "->") ) {
	    var relName = relationship.substring( 2 );

	    list.fromFragment = fragment.create( "FROM node AS fromNode" );
	    list.joinFragment = fragment.create( "JOIN relationship rel ON rel.from_id=fromNode.id and rel.name=?"
						 + " AND rel.active=1"
						 + " JOIN node node ON rel.to_id=node.id AND node.active=1",
						 [ relName ]);
	    list.whereFragment = fragment.create( "WHERE fromNode.id=? AND fromNode.active=1", [{ name:'parent' }] );
	}
	else if (startsWith( relationship, "<-") ) {
	    var relName = relationship.substring( 2 );

	    list.fromFragment = fragment.create( "FROM node AS toNode" );
	    list.joinFragment = fragment.create( "JOIN relationship rel ON rel.from_id=node.id AND rel.name=?"
						 + " AND rel.active=1"
						 + " JOIN node node ON rel.to_id=toNode.id AND node.active=1",
						 [ relName ]);
	    list.whereFragment = fragment.create( "WHERE toNode.id=? AND toNode.active=1", [{ name:'parent' }] );
	}
	else {
	    callback( new Error("Unrecognized relationship format") );
	}

	/* Merge all attributes that will require joins */

	list.allAttrs = {};
	list.orderAttrs = {};

	list.orderByFragment = fragment.empty;
	list.orderByInvertedFragment = fragment.empty;
	list.orderCondition = fragment.empty;
	list.orderConditionInverted = fragment.empty;
	if (orderColumns)
	{
	    for (var i in orderColumns)
	    {
		var attr = orderColumns[ i ].name;
		list.allAttrs[ attr ] = 1;
		list.orderAttrs[ attr ] = 1;
	    }
	    list.hasOrderColumns = 1;
	    list.orderByFragment = fragment.create( "ORDER BY" ).append( createOrderFragment( orderColumns, false ) );
	    list.orderByInvertedFragment = fragment.create( "ORDER BY" ).append( createOrderFragment( orderColumns, true ) );
	    list.orderCondition = createOrderConditionFragment( false );
	    list.orderConditionInverted = createOrderConditionFragment( true );
	}

	if (searchQuery)
	{
	    var conditionParser = condParser.parsePrepared( searchQuery );
	    list.hasCondition = 1;
	    list.conditionFragment = fragment.create( conditionParser.queryString, conditionParser.parameters );
	    for (var attr in conditionParser.attributes)
		list.allAttrs[ attr ] = 1;
	}

	if (extraCondition)
	{
	    var extraConditionParser = condParser.parsePrepared( extraCondition );
	    list.hasExtraCondition = 1;
	    list.extraConditionFragment = fragment.create( extraConditionParser.queryString, extraConditionParser.parameters )
	    for (var attr in extraConditionParser.attributes)
		list.allAttrs[ attr ] = 1;
	}

	list.attrJoinFragment = condParser.formatSqlJoinsFragment( list.allAttrs, "node" );

	list.baseQuery =
	    list.fromFragment
	    .concat( list.attrJoinFragment )
	    .append( list.whereFragment )
	    .append( list.hasCondition ? fragment.create( "AND" ).append( list.conditionFragment ) : fragment.empty );

	list.countQuery = fragment.create( "SELECT count(*) AS count" )
	    .append( list.baseQuery );

	if (list.hasExtraCondition)
	{
	    list.baseExtraQuery =
		list.baseQuery
		.concat( "AND" ).append( list.extraConditionFragment );

	    if (list.hasExtraCondition)
	    {
		list.extraCountQuery = fragment.create( "SELECT count(*) AS count" )
		    .append( list.baseExtraQuery );
	    }
	}

	if (list.hasOrderColumns)
	{
	    list.resolveNodeIndexQuery = fragment.create( "SELECT count(*) AS count" )
		.append( list.baseQuery )
		.append( fragment.create( "AND" ).append( list.orderCondition ) );

	    if (list.hasExtraCondition)
	    {
		list.selectPreviousExtraNodeQuery = fragment.create( "SELECT node.id" )
		    .append( list.baseExtraQuery )
		    .append( "AND" ).append( list.orderCondition )
		    .append( list.orderByInvertedFragment )
		    .append( "LIMIT 1" );

		list.selectNextExtraNodeQuery = fragment.create( "SELECT node.id" )
		    .append( list.baseExtraQuery )
		    .append( "AND" ).append( list.orderConditionInverted )
		    .append( list.orderByFragment )
		    .append( "LIMIT 1" );

		list.selectFirstExtraNodeQuery = fragment.create( "SELECT node.id" )
		    .append( list.baseExtraQuery )
		    .append( list.orderByFragment )
		    .append( "LIMIT 1" );

		list.selectLastExtraNodeQuery = fragment.create( "SELECT node.id" )
		    .append( list.baseExtraQuery )
		    .append( list.orderByInvertedFragment )
		    .append( "LIMIT 1" );
	    }
	}

	list.selectQuery =
	    (list.hasExtraCondition ?
	     fragment.create( "SELECT node.id," )
	     .append( list.extraConditionFragment )
	     .append( "AS extraCondition" )
	     : fragment.create( "SELECT node.id" ) )
	    .append( list.baseQuery )
	    .append( list.orderByFragment )
	    .append( fragment.create( "LIMIT ?, ?", [{ name:'windowStart' },
						     { name:'windowSize' }] ) );

	if (list.hasExtraQuery)
	{
	    list.selectExtraQuery =
		fragment.create( "SELECT node.id" )
		.append( list.baseExtraQuery )
		.append( list.orderByFragment )
		.append( fragment.create( "LIMIT ?, ?", [{ name:'windowStart' },
							 { name:'windowSize' }] ) );
	}
	return list;
    },

    _createList: function (parent, relationship, searchQuery,
			   attributeSpec, windowSize, windowStart,
			   extraCondition, orderColumns, user, callback)
    {
	assert.ok( windowSize, "Unbounded lists are currently not supported by _createList" );
	console.log( "*** Creating list ***" );

	var list = this._createListQueries( relationship, searchQuery, extraCondition, orderColumns );
	var self = this;
	var conn = this._db.connection();

	list.windowSize = windowSize;
	list.attributeSpec = attributeSpec;
	list.user = user;

	list.parentId = null;
	list.selectedIndex = null;
	list.selectedId = null;

	/* Main helper functions */

	var innerGetCenter = function( index ) {
	    innerGet( Math.max( 0, index - ( list.windowSize >> 1 ) ) );
	};

	var innerGet = function( startIndex ) {
	    list.windowStart = startIndex;
	    callback( null, list );
	};

	/* Initialization code */

	var inner_init = function (error, id) {
	    if (error)
	    {
		callback( error );
		return;
	    }

	    list.parentId = id;

	    if (windowStart == null)
	    {
		if (list.hasExtraCondition)
		{
		    self._listGetFirstSelectedNode( list, true, function (error, index, id) {
			list.selectedIndex = index;
			list.selectedId = id;
			innerGetCenter( index );
		    } );
		}
		else
		    innerGet( 0 );
	    }
	    else
	    {
		switch (typeof( windowStart ))
		{
		case 'object':
		    self._listGetIndexFromId( list, windowStart.id, function (error, index, id) {
			list.selectedIndex = index;
			list.selectedId = id;
			innerGetCenter( index );
		    } );
		    break;
		case 'number':
		    innerGet( windowStart );
		    break;
		default:
		    callback( new Error("Unknown object type. Parameter name: windowStart") );
		}
	    }
	};
	self._resolveId( parent, user, inner_init );
    },
    
    _getOrCreateUser: function (name, callback)
    {
	var self = this;

	self.get( "users", {}, 0, function (error, users) {
	    if (error)
	    {
		console.log( error );
		throw error;
	    }
	    var innerGet = function(retry) {
		self._getList( users.id, null, "name=='" + name + "'", null, 1, 0, null, null, null, function (error, list) {
		    if (error)
		    {
			console.log( error );
			throw error;
		    }
		    if (list.length > 0)
		    {
			callback( list[0] );
		    }
		    else if (retry)
		    {
			throw Error("Could not find new user after creating it!");
		    }
		    else
		    {
			var transaction = {
			    user: 0,
			    transaction: [
				{
				    method:'create',
				    nodeId: -1,
				    parent: users,
				    pathElem: name,
				    attributes: { name:name }
				}
			    ]
			};
			self.runTransaction( transaction, 0, function (error) {
			    if (error)
			    {
				console.log( error );
				throw error;
			    }
			    innerGet( true );
			} );
		    }
		} );
	    }
	    innerGet( false );
	} );
    },
    
    _openDatabase: function (dbPath, callback)
    {
//	console.log( dbPath );
	try
	{
	    fs.statSync( dbPath );
	}
	catch (e)
	{
	    fs.mkdirSync( dbPath, "755" );
	}
	try
	{
	    fs.statSync( dbPath + "/transactions" );
	}
	catch (e)
	{
	    fs.mkdirSync( dbPath + "/transactions", "755" );
	}

        var throwError = function (error, rows)
        {
            if (error)
		console.log( error );
        };
	this._dbPath = dbPath;
        process.chdir( dbPath );
	db = new lowLevelDb.LowLevelDb( 'sqlite.db' );
	var conn = db.connection();
	conn.start( false );
	
	conn.exec("CREATE TABLE IF NOT EXISTS node ("
		+ " id INTEGER NOT NULL,"
		+ " revision INTEGER NOT NULL,"
		+ " active INTEGER NOT NULL,"
		+ " deleted INTEGER NOT NULL,"
		+ " parent INTEGER NULL,"
		+ " pathelem TEXT NULL "
		+ ")" );
	conn.exec("CREATE TABLE IF NOT EXISTS attribute ("
		+ " node_id INTEGER NOT NULL,"
		+ " revision_start INTEGER NOT NULL,"
		+ " revision_end INTEGER NULL,"
		+ " active INTEGER NOT NULL,"
		+ " name TEXT NOT NULL,"
		+ " value NOT NULL"
		+ ")" );
	conn.exec("CREATE TABLE IF NOT EXISTS relationship ("
                + " from_id INTEGER NOT NULL,"
                + " to_id INTEGER NOT NULL,"
		+ " revision_start INTEGER NOT NULL,"
		+ " revision_end INTEGER NULL,"
		+ " active INTEGER NOT NULL,"
		+ " name TEXT NOT NULL"
                + ")" );
	conn.exec("CREATE TABLE IF NOT EXISTS tx ("
		+ " id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "
		+ " user INTEGER NOT NULL, "
		+ " timestamp INTEGER NOT NULL "
                + ")" );
	conn.exec("CREATE TABLE IF NOT EXISTS user_read ("
		+ " user INTEGER NOT NULL, "
		+ " node_id INTEGER NOT NULL, "
		+ " node_revision INTEGER NOT NULL, "
		+ " timestamp INTEGER NOT NULL "
		+ ")" );
	conn.exec("CREATE TABLE IF NOT EXISTS user_online ("
		+ " user INTEGER PRIMARY KEY NOT NULL, "
		+ " online BOOLEAN NOT NULL "
		+ ")" );
	conn.exec("DELETE FROM user_online");

	conn.close();

	conn = db.connection();
	conn.start( false );
	conn.query( "SELECT ifnull(max(id),0) AS max FROM tx" );

	var self = this;
	conn.go( function (error, result) {
	    if (error)
	    {
		console.log( error );
		callback( error );
		return;
	    }
	    conn.close();
	    last_tx = result[0][0].max;
	    max_tx = 0;
	    dir = fs.readdirSync( 'transactions/' );
	    for (var i in dir)
		if (endsWith( dir[i], '.json' ))
	    {
		tx = parseInt( dir[i] );
		if (tx > max_tx)
		    max_tx = tx;
	    }
//	    console.log( 'max_tx=' + max_tx + " last_tx=" + last_tx );
	    if (max_tx > last_tx)
	    {
		var i = last_tx + 1;

		var readTransaction = function()
		{
		    console.log( "readTransaction " + i );
		    self.runTransaction(
			JSON.parse( fs.readFileSync( 'transactions/' + i + '.json',
						     'utf-8' ) ), i,
			function (error) {
			    if (error)
			    {
				console.log( error );
				callback( error );
				return;
			    }
			    if (++i <= max_tx)
				readTransaction();
			    else
				callback();
			} );
		};
		if (i <= max_tx)
		    readTransaction();
		else
		    callback();
	    }
	    else if (max_tx == last_tx && max_tx == 0)
	    {
		self.runTransaction( { user: 0,
				       transaction:
				       [ { method: 'create',
					   nodeId: -1,
					   parent: 0,
					   pathElem: 'users',
					   attributes: { } } ] },
				     1,
				     function (error) {
					 if (error)
					 {
					     console.log( error );
					     callback( error );
					     return;
					 }
					 callback();
				     } );
	    }
	    else
		callback();
	} );
        this._db = db;
    },

    runTransaction: function( trans, nr, callback )
    {
	var self = this;

//	console.log( "run transaction" );
	var conn = this._db.connection();
	conn.start( true );
	if (trans.date)
	    date = new Date( trans.date );
	else
	{
	    date = new Date();
	    trans.date = date.toString();
	}
	var jsonTrans = JSON.stringify( trans );
//	console.log( trans );

	var checkPaths = function()
	{
//	    console.log( 'checkPaths' );
	    var pathsToLookup = { };

	    for (var i in trans.transaction)
	    {
		var step = trans.transaction[i];

		if (step.method == 'create')
		{
		    if (typeof( step.parent ) == 'string')
			pathsToLookup[ step.parent ] = 1;
		}
		else if (step.method == 'update' || step.method == 'delete')
		{
		    if (typeof( step.node ) == 'string')
			pathsToLookup[ step.node ] = 1;
		}
		else if (step.method == 'addRelationship' || step.method == 'deleteRelationship')
		{
		    if (typeof( step.to ) == 'string')
			pathsToLookup[ step.to ] = 1;
		    if (typeof( step.from ) == 'string')
			pathsToLookup[ step.from ] = 1;
		}
	    }

	    var lookupPaths = function(error, rows)
	    {
//		console.log( 'lookup paths' );
		if (error)
		{
		    conn.rollback();
		    console.log( 'check transaction error' );
		    callback( error );
		    return;
		}
		var cont = false;
		for (var i=0; i < rows.length; i++)
		{
		    var path = rows[i][0].parentPath + rows[i][0].pathelem + "/";
		    var moreWork = { };

		    for (var p in pathsToLookup)
		    {
			var cmp = comparePaths( path, p );

			if (!cmp)
			    continue;
			else if (typeof( cmp ) == 'string')
			{
			    if (moreWork[ cmp ])
				continue;
			    moreWork[ cmp ] = 1;
			    cont = true;
			    conn.query( "SELECT ? AS parentPath, pathelem, id, revision "
					+ "FROM node "
					+ "WHERE active=1 AND parent=? AND pathelem=? ",
					[ path, rows[i][0].id, cmp ] );
			}
			else
			    pathsToLookup[ p ] = { id: rows[i][0].id, revision: rows[i][0].revision };
		    }
		}
		if (cont)
		{
		    conn.go( lookupPaths );
		}
		else
		{
		    for (var i in trans.transaction)
		    {
			var step = trans.transaction[i];

			if (step.method == 'create')
			{
			    if (typeof( step.parent ) == 'string')
			    {
				if (typeof pathsToLookup[ step.parent ] == 'object')
				    step.parent = pathsToLookup[ step.parent ];
				else
				{
				    callback( new Error( 'Could not find ' + step.parent ) );
				    return;
				}
			    }
			}
			else if (step.method == 'update' || step.method == 'delete')
			{
			    if (typeof( step.node ) == 'string')
			    {
				if (typeof pathsToLookup[ step.node ] == 'object')
				    step.node = pathsToLookup[ step.node ];
				else
				{
				    callback( new Error( 'Could not find ' + step.node ) );
				    return;
				}
			    }
			}
			else if (step.method == 'addRelationship' || step.method == 'deleteRelationship')
			{
			    if (typeof( step.to ) == 'string')
			    {
				if (typeof pathsToLookup[ step.to ] == 'object')
				    step.to = pathsToLookup[ step.to ];
				else
				{
				    callback( new Error( 'Could not find ' + step.to ) );
				    return;
				}
			    }
			    if (typeof( step.from ) == 'string')
			    {
				if (typeof pathsToLookup[ step.from ] == 'object')
				    step.from = pathsToLookup[ step.from ];
				else
				{
				    callback( new Error( 'Could not find ' + step.from ) );
				    return;
				}
			    }
			}
		    }
		    checkNodes();
		}
	    }

	    var moreWork = { };
	    var found = false;

	    for (j in pathsToLookup)
	    {
		var cmp = comparePaths( '/', j );

		if (typeof( cmp ) == 'string')
		{
		    if (moreWork[ cmp ])
			continue;
		    found = true;
		    moreWork[ cmp ] = 1;
		    conn.query( "SELECT ? AS parentPath, pathelem, id, revision "
				+ "FROM node "
				+ "WHERE active=1 AND parent=? AND pathelem=? ",
				[ '/', 0, cmp ] );
		}
	    }
	    if (found)
	    {
		conn.go( lookupPaths );
	    }
	    else
	    {
		checkNodes();
	    }
	}

	var newNodes = { };
	var nodesToCheck = { };
	var checkNodes = function()
	{
//	    console.log( 'checkNodes' );

	    conn.insert( "INSERT INTO tx (user, timestamp) VALUES (?, ?)",
			 [ trans.user,
			   parseInt( (date.getTime() / 1000).toFixed() ) ] );

	    for (var i in trans.transaction)
	    {
		var step = trans.transaction[i];

		if (step.method == 'create')
		{
		    if (typeof step.parent == 'number')
		    {
			if (step.parent != 0 && !newNodes[ step.parent ])
			{
			    conn.rollback();
			    console.log( 'no such parent ' + step.parent );
			    callback( new Error() );
			    return;
			}
		    }
		    else if (!nodesToCheck[ step.parent.id ])
		    {
			nodesToCheck[ step.parent.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.parent.id ] );
		    }
		    newNodes[ step.nodeId ] = 1;
		}
		else if (step.method == 'update')
		{
		    if (!nodesToCheck[ step.node.id ])
		    {
			nodesToCheck[ step.node.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.node.id ] );
		    }
		    conn.query( "SELECT 'attribute' AS type, node_id, name "
				+ "FROM attribute "
				+ "WHERE node_id=? AND active=1",
				[ step.node.id ] );
		}
		else if (step.method == 'delete')
		{
		    if (!nodesToCheck[ step.node.id ])
		    {
			nodesToCheck[ step.node.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.node.id ] );
		    }
		}
		else if (step.method == 'addRelationship')
		{
		    if (typeof step.to == 'number')
		    {
			if (!newNodes[ step.to ])
			{
			    conn.rollback();
			    callback( new Error() );
			    return;
			}
		    }
		    else if (!nodesToCheck[ step.to.id ])
		    {
			nodesToCheck[ step.to.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.to.id ] );
		    }
		    if (typeof step.from == 'number')
		    {
			if (!newNodes[ step.from ])
			{
			    conn.rollback();
			    console.log( 'no such from ' + step.from );
			    callback( new Error() );
			    return;
			}
		    }
		    else if (!nodesToCheck[ step.from.id ])
		    {
			nodesToCheck[ step.from.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.from.id ] );
		    }
		    if (typeof step.to != 'number' && typeof step.from != 'number')
			conn.query( "SELECT 'relationship' AS type, from_id, to_id, name "
				    + "FROM relationship "
				    + "WHERE from_id=? AND to_id=? AND name=? ",
				    [ step.from.id, step.to.id, step.name ] );
		}
		else if (step.method == 'deleteRelationship')
		{
		    if (!nodesToCheck[ step.to.id ])
		    {
			nodesToCheck[ step.to.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.to.id ] );
		    }
		    if (!nodesToCheck[ step.from.id ])
		    {
			nodesToCheck[ step.from.id ] = 1;
			conn.query( "SELECT 'node' AS type, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1",
				    [ step.from.id ] );
		    }
		    conn.query( "SELECT 'relationship' AS type, from_id, to_id, name "
				+ "FROM relationship "
				+ "WHERE from_id=? AND to_id=? AND name=? ",
				[ step.from.id, step.to.id, step.name ] );
		}
	    }
	    conn.go( checkTransaction );
	}

	var nodes = { };
	var relationships = { };
	var attributes = { };
	var rowId;
	var revision;

	var checkTransaction = function(error, rows)
	{
//	    console.log( 'check transaction' );
	    if (error)
	    {
		conn.rollback();
//		console.log( 'check transaction error' );
		callback( error );
		return;
	    }
	    for (var i in rows)
	    {
		if (i == 0)
		{
		    rowId = rows[i];
		    continue;
		}
		for (var ii in rows[i])
		{
		    row = rows[i][ii];
		    if (row.type == 'node')
			nodes[ row.id ] = row.revision;
		    else if (row.type == 'attribute')
			attributes[ row.node_id + ":" + row.name ] = 1;
		    else if (row.type == 'relationship')
			relationships[ row.from_id + "-" + to_id + ":" + name ] = 1;
		}
	    }

	    for (var i in trans.transaction)
	    {
		var step = trans.transaction[i];

		if (step.method == 'create')
		{
		    if (!isFinite( step.parent ) && nodes[ step.parent.id ] != step.parent.revision)
		    {
			conn.rollback();
			console.log( "error in create" );
			callback( new Error() );
			return;
		    }
		}
		else if (step.method == 'update' || step.method == 'delete')
		{
		    if (nodes[ node.parent.id ] != node.parent.revision)
		    {
			conn.rollback();
			console.log( "error in update or delete" );
			callback( new Error() );
			return;
		    }
		}
		else if (step.method == 'addRelationship')
		{
		    if (!isFinite( step.from ) && nodes[ step.from.id ] != step.from.revision
			|| !isFinite( step.to ) && nodes[ step.to.id ] != step.to.revision
			|| !isFinite( step.from ) && !isFinite( step.to )
			   && relationship[ step.from.id + "-" + step.to.id + ":" + step.name ])
		    {
			conn.rollback();
			console.log( "error in add relationship" );
			callback( new Error() );
			return;
		    }
		}
		else if (step.method == 'deleteRelationship')
		{
		    if (nodes[ step.from.id ] != step.from.revision
			|| nodes[ step.to.id ] != step.to.revision
			|| !relationship[ step.from.id + "-" + step.to.id + ":" + step.name ])
		    {
			conn.rollback();
			console.log( "error in delete relationship" );
			callback( new Error() );
			return;
		    }
		}
	    }
	    conn.query( "SELECT id FROM tx WHERE ROWID=?", [ rowId ] );
	    conn.go( function (error, rows) {
		if (error)
		{
		    console.log( "error in select tx" );
		    callback( error );
		    return;
		}
		revision = rows[0][0].id;
		storeTransaction();
	    } );
	};

	var transStep = 0;
	var updatedNodes = {};

	var storeTransaction = function()
	{
	    console.log( 'storeTransaction' );
	    if (transStep >= trans.transaction.length)
	    {
		fs.writeFileSync( 'transactions/' + revision + '.json', jsonTrans );
		conn.commit();
		conn.go( function (error, rows) {
		    if (error)
		    {
			callback( error );
		    }
		    else
		    {
			conn.close();
			callback();
			self._invalidateAllLists();
		    }
		} );
		return;
	    }
	    var step = trans.transaction[ transStep++ ];

	    if (step.method == 'create')
	    {
		if (typeof step.parent == 'number')
		{
		    if (step.parent == 0)
			parent = step.parent;
		    else
			parent = newNodes[ step.parent ];
		}
		else
		    parent = step.parent.id;
		conn.insert( "INSERT INTO node "
			     + "(id, revision, active, deleted, parent, pathelem) "
			     + "SELECT ifnull(max(id),0)+1, ?, 1, 0, ?, ? "
			     + "FROM node ",
			     [ revision, parent, step.pathElem ] );
		var findNodeId = function (error, res)
		{
		    if (error)
		    {
			conn.rollback();
			callback( error );
			return;
		    }

		    var innerFindNodeId = function (error, res)
		    {
			if (error)
			{
			    conn.rollback();
			    callback( error );
			    return;
			}
			var nodeId = res[0][0].id;

//			console.log( nodeId );
			newNodes[ step.nodeId ] = nodeId;
			updatedNodes[ nodeId ] = 1;

			for (var i in step.attributes)
			    conn.insert( "INSERT INTO attribute "
					 + "(node_id, revision_start, active, name, value) "
					 + "VALUES (?, ?, 1, ?, ?) ",
					 [ nodeId, revision, i, step.attributes[i] ] );
			storeTransaction();
		    };

//		    console.log( res[ res.length-1 ] );
		    conn.query( "SELECT id FROM node WHERE ROWID=?",
				 [ res[ res.length-1 ] ] );
		    conn.go( innerFindNodeId );
		};
		conn.go( findNodeId );
		return;
	    }
	    else if (step.method == 'update')
	    {
		if (!updatedNodes[ step.node.id ])
		{
		    conn.insert( "INSERT INTO node "
				 + "(id, revision, active, deleted, parent, pathelem) "
				 + "SELECT id, ?, 1, 0, parent, pathelem "
				 + "FROM node "
				 + "WHERE id=? AND active=1 ",
				 [ revision, step.node.id ] );
		    conn.update( "UPDATE node "
				 + "SET active=0 "
				 + "WHERE id=? AND revision < ? ",
				 [ step.node.id, revision ] );
		    updatedNodes[ step.node.id ] = 1;
		}
		for (var i in step.attributes)
		{
		    if (attributes[ step.node.id + ":" + step.attributes[i] ])
			conn.update( "UPDATE attribute "
				     + "SET revision_end=? AND active=0 "
				     + "WHERE node_id=? AND name=? ",
				     [ step.node.id, step.attribute[i] ] );
		    if (step.values[ step.attributes[i] ])
			conn.insert( "INSERT INTO attribute "
				     + "(node_id, revision_start, active, name, value) "
				     + "VALUES (?, ?, 1, ?, ?) ",
				     [ step.node.id, revision, step.attributes[i],
				       step.values[ step.attributes[i] ] ] );
		}
	    }
	    else if (step.method == 'delete')
	    {
		conn.insert( "INSERT INTO node "
			     + "(id, revision, active, deleted, parent, pathelem) "
			     + "SELECT id, ?, 1, 0, parent, pathelem "
			     + "FROM node "
			     + "WHERE id=? AND active=1 ",
			     [ revision, step.node.id ] );
		conn.update( "UPDATE node "
			     + "SET active=0 "
			     + "WHERE id=? AND revision < ? ",
			     [ step.node.id, revision ] );
	    }
	    else if (step.method == 'addRelationship')
	    {
		if (isFinite( step.from ))
		    from = newNodes[ step.from ];
		else
		    from = step.from.id;
		if (isFinite( step.to ))
		    to = newNodes[ step.to ];
		else
		    to = step.to.id;
		if (!updatedNodes[ from ])
		{
		    conn.insert( "INSERT INTO node "
				 + "(id, revision, active, deleted, parent, pathelem) "
				 + "SELECT id, ?, 1, 0, parent, pathelem "
				 + "FROM node "
				 + "WHERE id=? AND active=1 ",
				 [ revision, from ] );
		    conn.update( "UPDATE node "
				 + "SET active=0 "
				 + "WHERE id=? AND revision < ? ",
				 [ from, revision ] );
		    updatedNodes[ from ] = 1;
		}
		if (!updatedNodes[ to ])
		{
		    conn.insert( "INSERT INTO node "
				 + "(id, revision, active, deleted, parent, pathelem) "
				 + "SELECT id, ?, 1, 0, parent, pathelem "
				 + "FROM node "
				 + "WHERE id=? AND active=1 ",
				 [ revision, to ] );
		    conn.update( "UPDATE node "
				 + "SET active=0 "
				 + "WHERE id=? AND revision < ? ",
				 [ to, revision ] );
		    updatedNodes[ to ] = 1;
		}
		conn.insert( "INSERT INTO relationship "
			     + "(from_id, to_id, revision_start, active, name) "
			     + "VALUES (?, ?, ?, 1, ?) ",
			     [ from, to, revision, step.name ] );
	    }
	    else if (step.method == 'deleteRelationship')
	    {
		from = step.from.id;
		to = step.to.id;
		if (!updatedNodes[ from ])
		{
		    conn.insert( "INSERT INTO node "
				 + "(id, revision, active, deleted, parent, pathelem) "
				 + "SELECT id, ?, 1, 0, parent, pathelem "
				 + "FROM node "
				 + "WHERE id=? AND active=1 ",
				 [ revision, from ] );
		    conn.update( "UPDATE node "
				 + "SET active=0 "
				 + "WHERE id=? AND revision < ? ",
				 [ from, revision ] );
		    updatedNodes[ from ] = 1;
		}
		if (!updatedNodes[ to ])
		{
		    conn.insert( "INSERT INTO node "
				 + "(id, revision, active, deleted, parent, pathelem) "
				 + "SELECT id, ?, 1, 0, parent, pathelem "
				 + "FROM node "
				 + "WHERE id=? AND active=1 ",
				 [ revision, to ] );
		    conn.update( "UPDATE node "
				 + "SET active=0 "
				 + "WHERE id=? AND revision < ? ",
				 [ to, revision ] );
		    updatedNodes[ to ] = 1;
		}
		conn.insert( "UPDATE relationship "
			     + "SET active=0, revision_end=? "
			     + "WHERE from_id=? AND to_id=? AND active=1 AND name=? ",
			     [ revision, from, to, step.name ] );
	    }
	    storeTransaction();
	};

	checkPaths();
    },

    fastGet: function( id, attr, user, callback )
    {
	console.log( "fast_get" );
	var conn = this._db.connection();
	conn.start( false );
	conn.query( "SELECT node.id AS id, revision, user, timestamp, parent "
		    + "FROM node, tx "
		    + "WHERE revision=tx.id AND node.id=? AND active=1 "
		    + "AND deleted=0",
		    [ id ] );
	var res = {};
	if (!isEmpty( attr.attr ))
	{
	    var attributes = indices( attr.attr );
	    conn.query( "SELECT 'attr' AS type, name, value "
			+ "FROM attribute "
			+ "WHERE node_id=? AND active=1 AND name IN (" + questionmarks( attributes.length ) + ")",
			[ id ].concat( attributes ) );
	    for (i in attr.attr)
		res[ i ] = null;
	}
	if (attr.userRead)
	{
	    res.u_read = false;
	    conn.query( "SELECT 'u_read' AS type, timestamp "
			+ "FROM user_read "
			+ "WHERE node_id=? AND node_revision=? AND user=?",
			[ id, res.revision, user ] );
	}
	if (attr.userOnline)
	{
	    res._online = false;
	    conn.query( "SELECT '_online' as type, online "
			+ "FROM user_online "
			+ "WHERE user=?",
			[ id ] );
	}
	conn.go( function (error, rows) {
	    if (error)
	    {
		console.log( error );
		callback( error );
		return;
	    }
	    console.log( "fast_get_res " + rows.length );
	    if (rows[0].length == 0)
	    {
		conn.close();
		callback( null, null );

		return;
	    }
	    res.id = rows[0][0].id;
	    res.revision = rows[0][0].revision;
	    res.user = rows[0][0].user;
	    res.timestamp = rows[0][0].timestamp;
	    res.parent_id = rows[0][0].parent_id;
	    for (i=1; i < rows.length; i++)
		for (j=0; j < rows[i].length; j++)
	        {
		    if (rows[i][j].type == 'attr')
		    {
			res[ rows[i][j].name ] = rows[i][j].value;
		    }
		    else if (rows[i][j].type == 'u_read')
			res.u_read = true;
		    else if (rows[i][j].type == '_online')
			res._online = rows[i][j].online != 0;
	        }
	    conn.close();
	    callback( null, res );
	    return;
	} );
    },

    get: function( id, attr, user, callback )
    {
	var self = this;

	try
	{
	    attr = attrParser.parse( attr );
	}
	catch (e)
	{
	    callback( e );
	    return;
	}

	var inner_get = function( error, id ) {
	    if (error)
	    {
		callback( error );
		return;
	    }
	    self.fastGet( id, attr, user, function (error, res) {
		if (error)
		{
		    callback( error );
		    return;
		}
		if (res == null)
		{
		    callback( null, null );
		    return;
		}
		if ((!attr.outRels || isEmpty( attr.outRels ))
		    && (!attr.inRels || isEmpty( attr.inRels )))
		{
		    callback( null, res );
		    return;
		}
		conn = self._db.connection();
		conn.start( false );
		for (i in attr.outRels)
		{
		    if (i == '')
			conn.query( "SELECT 'out' AS type, '' AS rel, id, revision "
				    + "FROM node "
				    + "WHERE parent=? AND active=1 "
				    + "LIMIT " + relationship_limit,
				    [ res.id ] );
		    else
			conn.query( "SELECT 'out' AS type, rel.name AS rel, node.id AS id, revision "
				    + "FROM node, relationship AS rel "
				    + "WHERE rel.from_id=? AND rel.active=1 AND name=? "
				    + "AND rel.to_id=node.id AND node.active=1"
				    + "LIMIT " + relationship_limit,
				    [ res.id, i ] );
		}
		for (i in attr.inRels)
		{
		    res[ i ] = [];
		    if (i == '')
			conn.query( "SELECT 'in' AS type, '' AS rel, id, revision "
				    + "FROM node "
				    + "WHERE id=? AND active=1"
				    + "LIMIT " + relationship_limit,
				    [ res.parent_id ] );
		    else
			conn.query( "SELECT 'in' AS type, rel.name AS rel, node.id AS id, revision "
				    + "FROM node, relationship AS rel "
				    + "WHERE rel.from_id=? AND rel.active=1 AND name=? "
				    + "AND rel.to_id=node.id AND node.active=1"
				    + "LIMIT " + relationship_limit,
				    [ res.id, i ] );
		}
		function fetchRels( count, rows, i, j )
		{
		    var rel = rows[i][0].rel;
		    if (j == 0)
			res[ rel ] = { max: count[ rows[i][0].type + rel ], arr: [] };
		    if (rows[i][0].type == 'in')
		    {
			for (var i in attr.inRels)
			{
			    if (attr.inRels[i] == rel)
			    {
				self.fastGet( rows[i][j].id, attr.inRels[i], user, function (error, res ) {
				    if (error)
				    {
					callback( error );
					return;
				    }
				    res[ "<-" + rel ][j] = res;
				    if (++j < rows[i].length)
					fetchRels( count, rows, i, j );
				    else if (++i < rows.length)
					fetchRels( count, rows, i, 0 );
				    else
					callback( null, res );
				} );
			    }
			}
		    }
		    else
		    {
			for (var i in attr.outRels)
			{
			    if (attr.outRels[i] == rel)
			    {
				self.fastGet( rows[i][j].id, attr.outRels[i], user, function (error, res ) {
				    if (error)
				    {
					callback( error );
					return;
				    }
				    res[ "->" + rel ][j] = res;
				    if (++j < rows[i].length)
					fetchRels( count, rows, i, j );
				    else if (++i < rows.length)
					fetchRels( count, rows, i, 0 );
				    else
					callback( null, res );
				} );
			    }
			}
		    }
		};
		conn.go( function (error, rows) {
		    if (error)
		    {
			callback( error );
			return;
		    }
		    var moreQueries = false;
		    var count = { };
		    for (var i in rows)
		    {
			if (rows[i].length == relationship_limit)
			{
			    moreQueries = true;
			    if (rows[i][0].type == 'out')
			    {
				if (rows[i][0].rel == '')
				{
				    conn.query( "SELECT 'out' AS type, '' AS rel, count(*) AS count "
						+ "FROM node "
						+ "WHERE parent=? AND active=1 ",
						[ res.id ] );
				}
				else
				{
				    conn.query( "SELECT 'out' AS type, rel.name AS rel, count(*) AS count "
						+ "FROM node, relationship AS rel "
						+ "WHERE rel.from_id=? AND rel.active=1 AND name=? "
						+ "AND rel.to_id=node.id AND node.active=1",
						[ res.id, rows[0][0].rel ] );
				}
			    }
			    else
			    {
				if (rows[i][0].rel == '')
				{
				    conn.query( "SELECT 'in' AS type, '' AS rel, count(*) AS count "
						+ "FROM node "
						+ "WHERE id=? AND active=1",
						[ res.parent_id ] );
				}
				else
				{
				    conn.query( "SELECT 'in' AS type, rel.name AS rel, count(*) AS count "
						+ "FROM node, relationship AS rel "
						+ "WHERE rel.from_id=? AND rel.active=1 AND name=? "
						+ "AND rel.to_id=node.id AND node.active=1",
						[ res.id, rows[0][0].rel ] );
				}
			    }
			}
			else
			    count[ rows[i][0].type + rows[i][0].rel ] = rows[i].length;
		    }
		    if (moreQueries)
		    {
			conn.go( function (error, countRows ) {
			    if (error)
			    {
				callback( error );
				return;
			    }
			    conn.close();
			    for (var i in countRows)
			    {
				count[ countRows[i][0].type + countRows[i][0].rel ]
				    = countRows[i][0].count;
			    }
			    fetchRels( count, rows, 0, 0 );
			} );
		    }
		    else
		    {
			conn.close();
			fetchRels( count, rows, 0, 0 );
		    }
		} );
	    } );
	};
	switch (typeof( id ))
	{
	case 'number':
	    inner_get( null, id );
	    break;
	case 'object':
	    if (id == null)
		throw new Error("Parameter error: id cannot be null");
	    else
		inner_get( null, id.id );
	    break;
	case 'string':
	    this._pathToId( id, user, inner_get );
	    break;
	default:
	    inner_get( new Error() );
	}
    },

    _resolveId: function( id, user, callback )
    {
	switch (typeof( id ))
	{
	case 'number':
	    callback( null, id );
	    break;
	case 'object':
	    callback( null, id.id );
	    break;
	case 'string':
	    this._pathToId( id, user, callback );
	    break;
	default:
	    callback( new Error() );
	}
    },

    _pathToId: function( path, user, callback )
    {
	console.log("pathtoid: " + path);
	if (path == '_me_')
	{
	    callback( null, user );
	    return;
	}
	path = splitPath( path );
	if (path.length == 0)
	{
	    callback( new Error() );
	    return;
	}
	var conn = this._db.connection();
	var i = 0;

	var inner = function( error, rows )
	{
	    // console.log( "inner:");
	    // console.log( rows );
	    if (error)
	    {
		callback( error );
		return;
	    }
	    if (rows[0].length == 0)
	    {
		conn.close();
		callback( new Error() );
		return;
	    }
	    var id = rows[0][0].id;
	    console.log( id );
	    if (i >= path.length)
	    {
		conn.close();
		callback( null, id );
	    }
	    else
	    {
		// console.log( "Searching for node: " );
		// console.log( path[i] );
		conn.query( "SELECT id FROM node WHERE parent=? AND pathelem=? AND active=1",
			    [ id, path[ i++ ] ] );
		conn.go( inner );
	    }
	};
	conn.start( false );
	inner( null, [ [ { id: 0 } ] ] );
    },
	
    runQuery: function( parent, relationship, condition, attr, windowSize, start )
    {
	var attrs = attrParser.parse( attr );
	var cond = condParser.parse( condition ); // Missing user

	var query = "SELECT * FROM node\n";

	query += formatSqlJoins( cond.root );
	query += "WHERE parent=? AND " + formatSqlCondition( cond.root );

	console.log( query );

//	console.log( attrs );
//	console.log( condParser.formatSqlCondition( cond.root ) );
    },

    mkdirp: function( path )
    {
	var arr = splitPath( path );
	var i = 0;
	var parent = 0;
	var conn = this._db.connection();
	var self = this;

	var innerMkdirp = function (error, res)
	{
	    if (error)
	    {
		console.log( "Could not create path " + path );
		return;
	    }
	    if (res[0].length > 0)
	    {
		parent = res[0][0];
		i++;
		if (i < arr.length)
		{
		    conn.query( "SELECT id FROM node WHERE active=1 AND parent=? AND pathelem=?",
				[ parent, arr[i] ] );
		    conn.go( innerMkdirp );
		}
		else
		    conn.close();
	    }
	    else
	    {
		conn.close();
		var transaction = {
		    user: 0,
		    transaction: [
		    ] };

		for (; i < arr.length; i++)
		{
		    transaction.transaction.push( { method: 'create',
						    nodeId: -i,
						    parent: parent,
						    pathElem: arr[i],
						    attributes: { } } );
		    parent = -i;
		}
		self.runTransaction( transaction, 0,
				     function (error)
				     {
					 if (error)
					     console.log( "Could not create path " + path );
				     } );
	    }
	}
	conn.start( false );
	conn.query( "SELECT * FROM node WHERE active=1 AND parent=? AND pathelem=?",
		    [ parent, arr[i] ] );
	conn.go( innerMkdirp );
    },
};

function splitPath( path )
{
    var arr = path.split( "/" );
    var res = [];

    for (var i in arr)
	if (arr[i] != "")
	    res.push( arr[i] );
    return res;
}

function startsWith( haystack, needle )
{
    return haystack.substring( 0, needle.length ) == needle;
}
    
function endsWith( haystack, needle )
{
    return haystack.length >= needle.length
        && haystack.substring( haystack.length - needle.length ) == needle;
}

function indices( obj )
{
    var res = [];

    for (i in obj)
	res.push( i );
    return res;
}

function questionmarks( n )
{
    if (n == 0)
	return "";
    return "?" + new Array(n).join(",?");
}

function isEmpty( obj )
{
    for (var i in obj)
    {
	if (obj.hasOwnProperty( i ))
	    return false;
    }
    return true;
}

function addPathToLookup( pathsToLookup, path )
{
    path = splitPath( path );
    lookup = pathsToLookup;
    for (var i=0; i < path.length; i++)
    {
	if (!lookup[ path[i] ])
	    lookup[ path[i] ] = { };
	lookup = lookup[ path[i] ];
    }
}

function comparePaths( pathA, pathB )
{
    if (!endsWith( pathA, '/' ))
	pathA += '/';
    if (!endsWith( pathB, '/' ))
	pathB += '/';

    if (pathA == pathB)
	return true;
    if (pathA.length > pathB.length
	|| pathB.substring( 0, pathA.length) != pathA)
	return false;
    return pathB.substring( pathA.length ).split( '/' )[0];
}

exports.DatabaseManager = DatabaseManager;
