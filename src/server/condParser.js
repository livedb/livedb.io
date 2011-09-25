var assert = require('assert');
var fragment = require('./sqlFragment');

Tokens =
{
    LEFT_PAREN: 1,
    RIGHT_PAREN: 2,
    INTEGER: 3,
    FLOAT: 4,
    STRING: 5,
    OPERATOR: 6,
    VARIABLE: 7,
    PLACEHOLDER: 8,
    EOF: 9
};

Token = function (id, value)
{
    this.id = id;
    this.value = value;
};

Token.prototype.toString = function ()
{
    return this.id + ":" + this.value;
};

Lexer = function ( expression )
{
    this._expression = expression;

    this._index = 0;

    this._tokens = [];

    this._lex();
};

Lexer.prototype =
{
    _peekChar: function()
    {
	return this._expression.charAt( this._index );
    },

    _consumeChar: function()
    {
	return this._expression.charAt( this._index++ );
    },

    _isEof: function ()
    {
	return this._expression.length == this._index;
    },

    _isDigit: function (character)
    {
	return /[0-9]/.test( character );
    },

    _isWhitespace: function (character)
    {
	return /\s/.test( character );
    },

    _isVariableChar: function (character)
    {
	return /[A-Za-z\_]/.test( character );
    },

    _addToken: function(token)
    {
	this._tokens.push( token );
    },

    _lexNumber: function()
    {
	var decimal = false;
	var number = "";
	while (!this._isEof())
	{
	    var t = this._peekChar();

	    if (this._isDigit(t))
		number += this._consumeChar();
	    else if (t == '.')
	    {
		if (decimal)
		    throw new Error("Parse error: More than one decimal point in number");
		decimal = true;
		number += this._consumeChar();
	    }
	    else
		break;
	}
	if (decimal)
	    this._addToken( new Token( Tokens.FLOAT, parseFloat(number) ) );
	else
	    this._addToken( new Token( Tokens.INTEGER, parseInt(number) ) );
    },

    _lexString: function()
    {
	var string = "";

	var type = this._consumeChar();

	assert.ok( type == "'" || type == '"' );

	while (!this._isEof())
	{
	    var c = this._peekChar();
	    if (c == type)
		break;

	    this._consumeChar()
	    if (c == '\\')
		string += this._consumeChar();
	    else
		string += c;
	}

	if (this._consumeChar() != type)
	    throw new Error("Parse error: Unterminated string");

	this._addToken( new Token( Tokens.STRING, string ) );
    },

    _atomics: {
	'+': Tokens.OPERATOR, 
	'-': Tokens.OPERATOR,
	'*': Tokens.OPERATOR,
	'/': Tokens.OPERATOR,
	'%': Tokens.OPERATOR,
	'&&': Tokens.OPERATOR,
	'||': Tokens.OPERATOR,
	'&': Tokens.OPERATOR,
	'^': Tokens.OPERATOR,
	'|': Tokens.OPERATOR,
	'==': Tokens.OPERATOR,
	'!=': Tokens.OPERATOR,
	'<=': Tokens.OPERATOR,
	'<': Tokens.OPERATOR,
	'>=': Tokens.OPERATOR,
	'>': Tokens.OPERATOR,
	'?': Tokens.PLACEHOLDER,
	'(': Tokens.LEFT_PAREN,
	')': Tokens.RIGHT_PAREN
    },

    _tryLexAtomic: function()
    {
	var remaining = this._expression.length - this._index;

	for (var t in this._atomics)
	{
	    if (remaining >= t.length && t == this._expression.substring( this._index, this._index + t.length ) )
	    {
		this._index += t.length;
		this._addToken( new Token( this._atomics[t], t ) );
		return true;
	    }
	}

	return false;
    },

    _lexVariable: function ()
    {
	var variable = '';
	while (!this._isEof() && this._isVariableChar( this._peekChar() ))
	{
	    variable += this._consumeChar();
	}
	this._addToken( new Token( Tokens.VARIABLE, variable ) );
    },

    _lexOne: function()
    {
	var t = this._peekChar();
	if (this._isWhitespace( t ))
	    this._consumeChar();
	else if (this._isVariableChar( t ))
	    this._lexVariable();
	else if (t == '"' || t == "'")
	    this._lexString();
	else if (this._isDigit( t ))
	    this._lexNumber();
	else if (!this._tryLexAtomic())
	    throw new Error("Parse error: Unrecognized character '" + t + "' at index " + this._index);
    },

    _lex: function()
    {
	while (!this._isEof())
	    this._lexOne();
	this._addToken( new Token( Tokens.EOF, null ) );
	this._index = 0;
    },

    peekToken: function ()
    {
	return this._tokens[this._index];
    },

    consumeToken: function ()
    {
	return this._tokens[this._index++];
    }
};

ConditionParser = function (condition, boundParameters)
{
    this._lexer = new Lexer( condition );

    this._attributes = new Array();

    this.__defineGetter__( 'attributes', function() { return this._attributes; } );

    this.__defineGetter__( 'root', function() { return this._root; } );

    if (boundParameters)
    {
	this._boundParameters = boundParameters;

	this._boundIndex = 0;
    }
    else
    {
	this._unboundParameters = true;

	this._boundIndex = 0;
    }

    this._root = this._parse();
};

ConditionParser.prototype =
{
    _binaryOperators: {
	'*': { prec: 5 },
	'/': { prec: 5 },
	'%': { prec: 5 },
	'+': { prec: 6 },
	'-': { prec: 6 },
	'<': { prec: 8 },
	'<=': { prec: 8 },
	'>': { prec: 8 },
	'>=': { prec: 8 },
	'==': { prec: 9 },
	'!=': { prec: 9 },
	'&': { prec: 10 },
	'^': { prec: 11 },
	'|': { prec: 12 },
	'&&': { prec: 13 },
	'||': { prec: 14 }
    },

    _variableOrConst: function()
    {
	var t = this._lexer.consumeToken();

	var node;

	switch (t.id)
	{
	case Tokens.VARIABLE:
	    this._attributes[ t.value ] = 1;

	    node = { type: 'variable', name: t.value };
	    break;

	case Tokens.PLACEHOLDER:
	    if (this._unboundParameters)
	    {
		node = { type: 'unbound', value: this._boundIndex++ };
	    }
	    else
	    {
		if (!this._boundParameters)
		    throw new Error("Parse error: Placeholder encountered without any parameters specified");
		else if (this._boundIndex >= this._boundParameters.length)
		    throw new Error("Parse error: Too few parameters for placeholders");
		node = this._boundParameters[ this._boundIndex++ ];
	    }
	    break;

	case Tokens.INTEGER:
	case Tokens.FLOAT:
	case Tokens.STRING:
	    node = t.value;
	    break;

	default:
	    throw new Error();
	}

	return node;
    },

    _resolveExpression: function( expr )
    {
	assert.ok( expr.length % 2 == 1 );

	if (expr.length == 1)
	    return expr[ 0 ];

	var max = 0;
	var maxAt;
	var maxOp;

	var node = { type: 'operator' };

	for (var i = expr.length - 2; i >= 1; i -= 2)
	{
	    var op = expr[ i ];
	    if (this._binaryOperators[ op ].prec > max)
	    {
		max = this._binaryOperators[ op ].prec;
		maxOp = op;
		maxAt = i;
	    }
	}

	node.left = this._resolveExpression( expr.slice( 0, maxAt ) );
	node.right = this._resolveExpression( expr.slice( maxAt + 1 ) );
	node.op = maxOp;

	return node;
    },

    _partialExpression: function()
    {
	var t = this._lexer.peekToken();

	var node;

	var res;

	switch (t.id)
	{
	case Tokens.LEFT_PAREN:
	    this._lexer.consumeToken();

	    node = this._expression();
	    
	    t = this._lexer.consumeToken(); 

	    if (t.id != Tokens.RIGHT_PAREN)
		throw new Error("Parse error: Parenthesis mismatch");

	    break;

	case Tokens.PLACEHOLDER:
	case Tokens.VARIABLE:
	case Tokens.INTEGER:
	case Tokens.FLOAT:
	case Tokens.STRING:
	    node = this._variableOrConst();
	    break;

	default:
	    throw new Error("Parse error: Unexpected token: " + t.toString() );
	}

	t = this._lexer.peekToken();

	if (t.id == Tokens.OPERATOR)
	{
	    this._lexer.consumeToken();

	    res = [ node, t.value ].concat( this._partialExpression() );
	}
	else
	    res = [ node ];

	return res;
    },

    _expression: function()
    {
	return this._resolveExpression( this._partialExpression() );
    },

    _parse: function()
    {
	var res = this._expression();

	var t = this._lexer.peekToken();

	if (t.id != Tokens.EOF)
	    throw new Error("Parse error");

	return res;
    },
};

var _sqlOperatorConversion = {
    '+': '+',
    '-': '-',
    '*': '*',
    '/': '/',
    '%': '%',
    '&&': ' AND ',
    '||': ' OR ',
    '&': '&',
    '^': '^',
    '|': '|',
    '==': '=',
    '!=': '<>',
    '<=': '<=',
    '<': '<',
    '>=': '>=',
    '>': '>'
};

function formatSqlJoinsFragment (attributes, nodeName, user)
{
    var sql = "";
    var parameters = [];

    for (var i in attributes)
    {
	var attribute = i;
	if (attribute == 'u_read')
	{
	    sql += "LEFT OUTER JOIN user_read u_read ON u_read.node_id=" + nodeName + ".id"
		+ " AND u_read.user=? ";
	    parameters.push( { name:'user', value:user } );
	}
	else if (attribute == '_online')
	{
	    sql += "LEFT OUTER JOIN user_online ON user_online.user=" + nodeName + ".id ";
	}
	else if (!startsWith( attribute, '_' ))
	{
	    sql += "LEFT OUTER JOIN attribute [a_" + attribute + "]"
		+ " ON [a_" + attribute + "].node_id=" + nodeName + ".id"
		+ " AND [a_" + attribute + "].name='" + attribute + "'"
		+ " AND [a_" + attribute + "].active=1 ";
	}
    }

    return fragment.create( sql, parameters );
}

function formatSqlJoins (attributes, nodeName, user)
{
    var sql = "";

    for (var i in attributes)
    {
	var attribute = i;
	if (attribute == 'u_read')
	{
	    sql += "LEFT OUTER JOIN user_read u_read ON u_read.node_id=" + nodeName + ".id"
		+ " AND u_read.user='" + user + "' ";
	}
	else if (attribute == '_online')
	{
	    sql += "LEFT OUTER JOIN user_online ON user_online.user=" + nodeName + ".id ";
	}
	else if (!startsWith( attribute, '_' ))
	{
	    sql += "LEFT OUTER JOIN attribute [a_" + attribute + "]"
		+ " ON [a_" + attribute + "].node_id=" + nodeName + ".id"
		+ " AND [a_" + attribute + "].name='" + attribute + "'"
		+ " AND [a_" + attribute + "].active=1 ";
	}
    }

    return sql;
}

function formatStaticSqlCondition (condition)
{
    var construct = function (node)
    {
	var res;

	switch (typeof( node ))
	{
	case 'number':
	    res = '' + node;
	    break;
	case 'string':
	    res = "'" + node.replace(/\'/, "''") + "'";
	    break;
	case 'object':
	    switch( node.type )
	    {
	    case 'operator':
		res = '(' + construct( node.left )
		    + _sqlOperatorConversion[ node.op ]
		    + construct( node.right ) + ')';
		break;
	    case 'variable':
		if (node.name == 'u_read')
		    res = '(u_read.user IS NOT NULL)';
		else if (node.name == '_online')
		    res = '(user_online.online=1)';
//		else if (startsWith( node.name, 'u_' ))
//		    res = node.name;
		else
		    res = '[a_' + node.name + '].value';
		break;
	    case 'unbound':
		throw new Error("Cannot format query directly with unbound parameters");
		break;
	    default:
		throw new Error("Formatting exception: Unknown node type '" + node.type + "'");
	    }
	    break;
	default:
	    throw new Error("Formatting exception: Unknown object type '" + typeof( node ) + "'" );
	}

	return res;
    };

    return construct( condition );
}

function StaticSqlCondition (condition, user, parameters)
{
    var parser = new ConditionParser( condition, parameters );

    this._queryString = formatStaticSqlCondition( parser.root );

    this._attributes = parser.attributes;

    this._joinsString = formatSqlJoins( this._attributes, "node", user );

    this.__defineGetter__( 'queryString', function() { return this._queryString; } );

    this.__defineGetter__( 'attributes', function() { return this._attributes; } );

    this.__defineGetter__( 'joinsString', function() { return this._joinsString; } );
}

function formatPreparedSqlCondition (condition)
{
    var construct = function (node, res)
    {
	switch (typeof( node ))
	{
	case 'number':
	case 'string':
	    res.queryString += '?';
	    res.parameters.push( node );
	    break;
	case 'object':
	    switch( node.type )
	    {
	    case 'operator':
		res.queryString += '(';
		construct( node.left, res );
		res.queryString += _sqlOperatorConversion[ node.op ];
		construct( node.right, res );
		res.queryString += ')';
		break;
	    case 'variable':
		if (node.name == 'u_read')
		    res.queryString += '(u_read.user IS NOT NULL)';
		else if (node.name == '_online')
		    res.queryString += '(user_online.online=1)';
//		else if (startsWith( node.name, 'u_' ))
//		    res.queryString += node.name;
		else
		    res.queryString += '[a_' + node.name + '].value';
		break;
	    case 'unbound':
		res.queryString += '?';
		res.parameters.push( node );
		break;
	    default:
		throw new Error("Formatting exception: Unknown node type '" + node.type + "'");
	    }
	    break;
	default:
	    throw new Error("Formatting exception: Unknown object type '" + typeof( node ) + "'" );
	}
    };

    var res = {
	queryString: "",

	parameters: []
    };

    construct( condition, res );

    return res;
}

function PreparedSqlCondition (condition, user, initialParameters)
{
    var parser = new ConditionParser( condition );

    var prep = formatPreparedSqlCondition( parser.root );

    this._queryString = prep.queryString;

    this._parameters = prep.parameters;

    this._attributes = parser.attributes;

    this._joinsString = formatSqlJoins( this._attributes, "node", user );

    this._bindMap = {};

    this.__defineGetter__( 'queryString', function() { return this._queryString; } );

    this.__defineGetter__( 'parameters', function() { return this._parameters; } );
    
    this.__defineGetter__( 'attributes', function() { return this._attributes; } );

    this.__defineGetter__( 'joinsString', function() { return this._joinsString; } );

    for (var i = 0; i < this._parameters.length; i++)
    {
	var node = this._parameters[ i ];

	if (typeof( node ) == 'object' && node.type == 'unbound')
	{
	    this._bindMap[ node.value ] = i;

	    this._parameters[ i ] = null;
	}
    }

    if (initialParameters)
	this.bind( initialParameters );
}

PreparedSqlCondition.prototype =
{
    bind: function (parameters)
    {
	for (var i = 0; i < parameters.length; i++)
	{
	    this._parameters[ this._bindMap[ i ] ] = parameters[ i ];
	}
    }
}

function startsWith( haystack, needle )
{
    return haystack.substring( 0, needle.length ) == needle;
}

function parse (condition, user, parameters)
{
    return new StaticSqlCondition( condition, user, parameters );
}

function parsePrepared (condition, user, initialParameters)
{
    return new PreparedSqlCondition( condition, user, initialParameters );
}

exports.parse = parse;

exports.parsePrepared = parsePrepared;

exports.formatSqlJoins = formatSqlJoins;

exports.formatSqlJoinsFragment = formatSqlJoinsFragment;
