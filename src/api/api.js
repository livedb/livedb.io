var _liveDb;

function LiveDB(uri){

    this.ME = '_me_';
    this.USERS = '/users/';

    this._nextSubscriberId = 1;
    this._eventSubscribers = {};

    this.connect( uri );
    _liveDb = this;
}

LiveDB.prototype = {

    _onEvent: function (obj){
	if (this._eventSubscribers[obj.id] && this._eventSubscribers[obj.id].fn
	    && (typeof this._eventSubscribers[obj.id].fn) == 'function')
	    this._eventSubscribers[obj.id].fn(obj.result);
    },

    login: function(callback, name){
	var subscriberId = this._nextSubscriberId++;
	this._eventSubscribers[subscriberId] = { id:subscriberId, fn:callback };
	this._socket.json.send( { method:'login', name:name, id:subscriberId  } );
	return subscriberId;
    },

    get: function (id, attr, callback){

	var subscriberId = this._nextSubscriberId++;
	var node = new Node( subscriberId, callback );
	this._eventSubscribers[subscriberId] = { id:subscriberId, fn:function( res ) {
	    node.update( res );
	} };
	this._socket.json.send({ method:'get', nodeId:id, attr:attr, id:subscriberId });
	return node;
    },

    list: function (callback, parent, relationship, searchQuery, attributeSpec,
		    windowSize, windowStart, extraCondition, orderColumns) {

	var subscriberId = this._nextSubscriberId++;
	var list = new List( subscriberId, callback );
	this._eventSubscribers[subscriberId] = { id:subscriberId, fn:function( res ) {
	    list.update( res );
	} };
	this._socket.json.send({ method:'list', parent:parent, relationship:relationship, searchQuery:searchQuery,
				 attributeSpec:attributeSpec, windowSize:windowSize, windowStart:windowStart,
				 extraCondition:extraCondition, orderColumns:orderColumns, id:subscriberId });
	return list;
    },

    _esc: function(msg){
	return msg.replace(/&/, '&amp;' ).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
      
    connect: function(uri){
	this._socket = io.connect( uri );
	this._socket.on('message', function(obj) {
	    _liveDb._onEvent( obj );
	});
      
	this._socket.on('connect', function(){
		_message({ message: ['System', 'Connected']});
	    });
	this._socket.on('disconnect', function(){ 
		_message({ message: ['System', 'Disconnected']});
	    });
	this._socket.on('reconnect', function(){ 
		_message({ message: ['System', 'Reconnected to server']});
	    });
	this._socket.on('reconnecting', function( nextRetry ){ 
		_message({ message: ['System',
				     'Attempting to re-connect to the server,'+
				     'next attempt in ' + nextRetry + 'ms']});
	    });
	this._socket.on('reconnect_failed', function(){
		_message({ message: ['System',
				     'Reconnected to server FAILED.']});
	    });
    },

    transaction: function(){
	var subscriberId = this._nextSubscriberId++;
	var self = this;
	var transaction = new Transaction( subscriberId, function ( callback ) {
	    self._eventSubscribers[subscriberId] = { id:subscriberId, fn:callback };
	    self._socket.json.send( { method:'transaction', transaction:transaction, id:subscriberId } );
	} );
	return transaction;
    },

    send: function( obj ) {
	this._socket.json.send( obj );
    },

    closeNode: function( sid ) {
	delete this._eventSubscribers[ sid ];
	this._socket.json.send( { method:'closeNode', id:sid } );
    },

    closeList: function( sid ) {
	delete this._eventSubscribers[ sid ];
	this._socket.json.send( { method:'closeList', id:sid } );
    }
};

function _message (obj){
    if( obj.message && window.console && console.log ){
	console.log(obj.message[0], obj.message[1]);
    }
};

function Node( sid, callback ) {
    this._sid = sid;
    this._res = null;
    this._callback = callback;
}

Node.prototype =
{
    update: function( res )
    {
	this._res = res;
	this._callback( this );
    },

    close: function()
    {
	_liveDb.closeNode( this._sid );
    },

    item: function()
    {
	return this._res;
    }
}

function List( sid, callback ) {
    this._sid = sid;
    this._properties = null;
    this._list = null;
    this._callback = callback;
}
      
List.prototype =
{
    update: function( res )
    {
	this._properties = res.properties;
	this._list = res.list;
	this._callback( this );
    },

    size: function()
    {
	return this._properties.count;
    },

    offset: function()
    {
	return this._properties.windowStart;
    },

    windowSize: function()
    {
	return this._properties.windowSize;
    },

    items: function()
    {
	return this._list;
    },

    next: function()
    {
	var windowStart = Math.min(this._properties.count - 1,
				   this._properties.windowStart + this._properties.windowSize);
	_liveDb.send( { method:'moveList', movement:'to',
			windowStart:windowStart, id:this._sid } );
    },

    previous: function()
    {
	var windowStart = Math.max(0, this._properties.windowStart - this._properties.windowSize);
	_liveDb.send( { method:'moveList', movement:'to',
			windowStart:windowStart, id:this._sid } );
    },

    first: function()
    {
	_liveDb.send( { method:'moveList', movement:'first', id:this._sid } );
    },

    last: function()
    {
	_liveDb.send( { method:'moveList', movement:'last', id:this._sid } );
    },

    nextSelected: function()
    {
	_liveDb.send( { method:'moveList', movement:'nextSelected', id:this._sid } );
    },

    previousSelected: function()
    {
	_liveDb.send( { method:'moveList', movement:'previousSelected', id:this._sid } );
    },

    selectedId: function()
    {
	return this._properties.selectedId;
    },

    close: function()
    {
	_liveDb.closeList( this._sid );
    },
};

function Transaction( subscriberId, callback ) {
    this.transaction = [ ];
    this.nodes = -1;
    this._callback = callback;
};

Transaction.prototype = 
{
    /**
     * @returns temporary Node
     */
    create: function( parent, attributes, pathElem )
    {
	if (parent && parent.id)
	    parent = { id: parent.id, revision: parent.revision };
	this.transaction.push(
	    {
		method: 'create',
		nodeId: this.nodes,
		parent: parent,
		pathElem: pathElem,
		attributes: attributes,
	    } );
	return this.nodes--;
    },

    update: function( node, attributes, values )
    {
	if (node && node.id)
	    node = { id: node.id, revision: node.revision };
	this.transaction.push(
	    {
		method: 'update',
		node: node,
		attributes: attributes,
		values: values,
	    } );
    },

    delete: function( node )
    {
	if (node && node.id)
	    node = { id: node.id, revision: node.revision };
	this.transaction.push(
	    {
		method: 'delete',
		node: node,
	    } );
    },

    addRelationship: function( to, from, name, checkLoop )
    {
	if (to && to.id)
	    to = { id: to.id, revision: to.revision };
	if (from && from.id)
	    from = { id: from.id, revision: from.revision };
	this.transaction.push(
	    {
		method: 'addRelationship',
		to: to,
		from: from,
		name: name,
		checkLoop: checkLoop,
	    } );
    },
 
    deleteRelationship: function( to, from, name )
    {
	if (to && to.id)
	    to = { id: to.id, revision: to.revision };
	if (from && from.id)
	    from = { id: from.id, revision: from.revision };
	this.transaction.push(
	    {
		method: 'deleteRelationship',
		to: to,
		from: from,
		name: name,
	    } );
    },

/*    addAttachment: function( obj, user_attachment )
    {
    },

    deleteAttachment: function( obj, attachment )
    {
    }*/

    go: function( errorCallback )
    {
	this._callback( this, errorCallback );
    },

    close: function()
    {
	
    },
};
