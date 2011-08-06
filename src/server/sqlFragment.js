var assert = require('assert');

var empty = new SqlFragment();

function SqlFragment( sql, parameters )
{
    if (sql)
    {
	this._sql = sql;

	this._bindings = {};

	if (parameters)
	{
	    this._parameters = parameters;

	    this._parseBindings( parameters, 0 );
	}
	else
	{
	    this._parameters = [];
	}
    }
    else
    {
	this._sql = "";

	this._parameters = [];

	this._bindings = {};
    }

    this.__defineGetter__( 'sql', function() { return this._sql; } );

    this.__defineGetter__( 'parameters', function() { return this._parameters; } );
}

SqlFragment.prototype = {

    append: function( fragment, parameters )
    {
	if (typeof( fragment ) == 'string')
	{
	    this._sql += ' ' + fragment;

	    if (parameters)
	    {
		var offset = this._parameters.length;

		//this._parameters.push.apply( this._parameters, parameters );

		this._parseBindings( parameters, offset );
	    }
	}
	else if (fragment._sql)
	{
	    var offset = this._parameters.length;

	    this._sql += ' ' + fragment._sql;

	    this._parameters.push.apply( this._parameters, fragment._parameters );

	    for (var b in fragment._bindings)
		this._addBinding( b, fragment._bindings[ b ], offset );
//		this._bindings[ b ] = fragment._bindings[ b ] + offset;
	}
	return this;
    },

    concat: function( fragment, parameters )
    {
	if (typeof( fragment ) == 'string')
	{
	    return this._clone()
		.append( fragment, parameters );
	}
	else if (fragment._sql)
	{
	    var offset = this._parameters.length;

	    var newFragment = new SqlFragment();
	    newFragment._sql = this._sql + ' ' + fragment._sql;
	    newFragment._parameters = this._parameters.concat( fragment._parameters );

	    for (var b in this._bindings)
		newFragment._addBinding( b, this._bindings[ b ], 0 );
//		newFragment._bindings[ b ] = this._bindings[ b ];
	    for (var b in fragment._bindings)
		newFragment._addBinding( b, fragment._bindings[ b ], offset );
//		newFragment._bindings[ b ] = fragment._bindings[ b ] + offset;

	    return newFragment;
	}
	else
	{
	    return this._clone();
	}
    },

    tryBind: function( name, value )
    {
	if (name in this._bindings)
	{
	    var binding = this._bindings[ name ];
	    for (var i in binding)
	    {
		assert.ok( binding[ i ] < this._parameters.length );

		this._parameters[ binding[ i ] ] = value;
	    }
//	    this._parameters[ this._bindings[ name ] ] = value;
	    return true;
	}
	else
	    return false;
    },

    bind: function( name, value )
    {
	assert.ok( name in this._bindings )
	var binding = this._bindings[ name ];

	for (var i in binding)
	{
	    console.log( this._bindings);
	    console.log( this._parameters );
	    assert.ok( binding[ i ] < this._parameters.length );

	    this._parameters[ binding[ i ] ] = value;
	}
//	this._parameters[ this._bindings[ name ] ] = value;
    },

    _clone: function()
    {
	var clone = new SqlFragment();
	var cloneBindings

	clone._sql = this._sql;
	clone._parameters = this._parameters.slice(0);
	cloneBindings = {}
	
	for (var b in this._bindings)
	    cloneBindings[ b ] = this._bindings[ b ].slice(0);

	clone._bindings = cloneBindings;

	return clone;
    },

    _parseBindings: function( parameters, offset )
    {
	assert.ok( typeof( offset ) == 'number' );
	for (var i = 0; i < parameters.length; i++)
	{
	    var parameter = parameters[ i ];
	    
	    if (parameter != null && typeof( parameter ) == 'object')
	    {
		var j = i + offset;

		assert.ok( typeof( parameter.name ) == 'string' );

		this._addBinding( parameter.name, i, offset );

		if ('value' in parameter)
		    this._parameters[ j ] = parameter.value;
		else
		    this._parameters[ j ] = null;
	    }
	}
    },

    _addBinding: function( name, index, offset )
    {
	assert.ok( typeof( offset ) == 'number' );
	assert.ok( typeof( name ) == 'string' );
	if (typeof( index ) == 'number')
	{
	    if (name in this._bindings)
		this._bindings[ name ].push( index + offset );
	    else
		this._bindings[ name ] = [ index + offset ];
	}
	else
	{
	    assert.ok( index.length > 0 );
	    for (var b = 0; b < index.length; b++)
	    {
		assert.ok( typeof( index[ b ] ) == 'number' );
		this._addBinding( name, index[ b ], offset )
	    }
	}
    },
}

function fragment( sql, parameters )
{
    return new SqlFragment( sql, parameters );
}

exports.create = fragment;

exports.empty = empty;

// var hej = fragment("? ? ? ", [{ name:'abc' }, { name:'abc' }, 132]);

// console.log( hej );

// var hoj = hej.concat("? ", [{ name:'abc' }]);

// console.log( hoj );

// hoj.bind('abc', "KORV")

// console.log( hoj );
