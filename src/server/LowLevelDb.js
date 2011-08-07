var sqlite3 = require( 'sqlite3' );

//var sys = require( 'sys' );
//var sqlite = require('sqlite');

LowLevelDb = function (dbPath)
{
    var self = this;

    this.db = new sqlite3.Database( dbPath );
//    This.db = new sqlite.Database( dbPath );
    this.lockQueue = [];
    this.db.serialize();
    this.connectionNr = 1;

/*    this.opened = false;
    this.db.open( dbPath, function (error) {
	if (error)
	{
	    console.log( "Tonight. You." );
	    throw error;
	}
	self.opened = true;
	console.log( 'open' );
	if (self.lockQueue.length >= 1)
	{
	    console.log( 'open lock callback' );
	    self.lockQueue[0]();
	}
    } );*/
};

LowLevelDb.prototype =
{
    close: function()
    {
	this.db.close( function (error ) { } )
    },

    connection: function()
    {
	return new Connection( this );
    },

    _lock: function( callback )
    {
//	console.log( '_lock' );
	this.lockQueue.push( callback );
	if (/*this.opened &&*/ this.lockQueue.length == 1)
	{
//	    console.log( '_lock calling callback' );
	    callback();
	}
    },

    _unlock: function()
    {
//	console.log( '_unlock' );
	this.lockQueue.shift();
	if (this.lockQueue.length >= 1)
	    this.lockQueue[0]();
    },
};

Connection = function( db )
{
    this.db = db;
    this.callback = null;
    this.modify = false;
    this.waitForLock = false;
    this.queue = [ ];
    this.result = [ ];
    this.error = null;
    this.inWait = false;
    this.nr = db.connectionNr++;
};

Connection.prototype =
{
    start: function( modify )
    {
	// console.log( "Connection " + this.nr + " start" );

	var self = this;

	this._clear();
	this.modify = modify;
	this.waitForLock = true;
	this.db._lock( function() {
	    // console.log( '_startCallback' );
	    self.waitForLock = false;
	    if (self.modify)
	    {
		// console.log( "BEGIN TRANSACTION" );
		self.db.db.run( "BEGIN TRANSACTION" );
	    }
	    for (var i in self.queue)
	    {
		var step = self.queue[i];

		if (step[0] == 'close')
		{
		    self.db._unlock();
		}
		else if (step[0] == 'commit')
		{
		    // console.log( "COMMIT" );
		    self.db.db.run( "COMMIT", function (error) {
			self._callback( error ); } );
		    self.db._unlock();
		}
		else if (step[0] == 'rollback')
		{
		    // console.log( "ROLLBACK" );
		    self.db.db.run( "ROLLBACK", function (error) {
			self._callback( error ); } );
		    self.db._unlock();
		}
		else if (step[0] == 'query')
		{
		    // console.log( step[1] );
		    self.db.db.all( step[1], step[2],function (error, rows) {
			self._callback( error, rows ); } );
		}
		else if (step[0] == 'insert')
		{
		    // console.log( step[1] );
		    self.db.db.run( step[1], step[2], function (error) {
			if (error)
			    self._callback( error );
			else
			    self._callback( error, this.lastID ); } );
		}
		else if (step[0] == 'update')
		{
		    // console.log( step[1] );
		    self.db.db.run( step[1], step[2], function (error ) {
			if (error)
			    self._callback( error );
			else
			    self._callback( error, this.changed ); } );
		}
	    }
	} )
    },

    close: function()
    {
	// console.log( "Connection " + this.nr + " close" );

	if (this.db.waitForLock)
	    this.queue.push( [ 'close' ] );
	else
	    this.db._unlock();
    },

    commit: function()
    {
	// console.log( "Connection " + this.nr + " commit" );

	if (this.error)
	    return;
	this.queue.push( [ 'commit' ] );
	if (!this.waitForLock)
	{
	    var self = this;

	    // console.log( "COMMIT" );
	    this.db.db.run( "COMMIT", function (error, result) {
		self._callback( error, this ); } );
	    this.db._unlock();
	}
    },

    rollback: function()
    {
	// console.log( "Connection " + this.nr + " rollback" );

	if (this.error)
	    return;
	this.queue.push( [ 'rollback' ] );
	if (!this.waitForLock)
	{
	    var self = this;

	    // console.log( "ROLLBACK" );
	    this.db.db.run( "ROLLBACK", function (error, result) {
		self._callback( error, this ); } );
	    this.db._unlock();
	}
    },

    _clear: function()
    {
	// console.log( "Connection " + this.nr + " _clear" );

	this.error = null;
	this.queue = [];
	this.result = [];
	this.inWait = false;
    },

    go: function( callback )
    {
	// console.log( "Connection " + this.nr + " go" );

	//// console.log( this.queue );
	this.callback = callback;
	if (this.error)
	{
	    var error = this.error;

	    this._clear();
	    this.callback( error );
	}
	else if (this.queue.length == this.result.length)
	{
	    var result = this.result;

	    this._clear();
	    this.callback( null, result );
	}
	else
	    this.inWait = true;
    },

    _callback: function( error, rows )
    {
	// console.log( "Connection " + this.nr + " _callback" );
//	console.log( '_callback' );
	if (error)
	{
//	    console.log( 'error' );
//	    console.log( error );
	    if (this.inWait)
	    {
		this._clear();
		this.callback( error );
	    }
	    else if (!this.error)
	    {
		this.error = error;
		this.db._unlock();
	    }
	}
	else
	{
//	    console.log( rows );
	    this.result.push( rows );
	    if (this.queue.length == this.result.length && this.inWait)
	    {
		var result = this.result;

		this._clear();
		this.callback( null, result );
	    }
	}
    },
	
    query: function( query, parameters )
    {
	// console.log( "Connection " + this.nr + " query" + query + " " + parameters );
//	console.log( query );
	this.queue.push( [ 'query', query, parameters ] );
	if (!this.waitForLock)
	{
//	    console.log( 'running query' );
	    var self = this;

	    // console.log( query );
	    this.db.db.all( query, parameters, function (error, rows) {
		self._callback( error, rows ); } );
	}
    },

    insert: function( query, parameters )
    {
	// console.log( "Connection " + this.nr + " insert " + query + " " + parameters );
//	console.log( query );
	this.queue.push( [ 'insert', query, parameters ] );
	if (!this.waitForLock)
	{
//	    console.log( 'running insert' );
	    var self = this;

	    // console.log( query );
	    this.db.db.run( query, parameters, function (error) {
		if (error)
		    self._callback( error );
		else
		    self._callback( error, this.lastID ); } );
	}
    },

    update: function( query, parameters )
    {
	// console.log( "Connection " + this.nr + " query" + query + " " + parameters );
//	console.log( query );
	this.queue.push( [ 'update', query, parameters ] );
	if (!this.waitForLock)
	{
//	    console.log( 'running update' );
	    var self = this;

	    // console.log( query );
	    this.db.db.run( query, parameters, function (error, result) {
		if (error)
		    self._callback( error );
		else
		    self._callback( error, this.changed ); } );
	}
    },

    delete: function( query, parameters )
    {
	// console.log( "Connection " + this.nr + " delete" );
	this.update( query, parameters );
    },

    exec: function( query, parameters )
    {
	// console.log( "Connection " + this.nr + " exec" );
	this.update( query, parameters );
    },
};

exports.LowLevelDb = LowLevelDb;
