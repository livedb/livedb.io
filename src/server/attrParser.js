function parse( attr )
{
    return innerParse( attr, false );
}

function innerParse( attr, level )
{
    var res;

    if (level)
	res = { attr: [], u_read: false };
    else
	res = {
	    attr: {},
	    outRels: {},
	    inRels: {},
	    u_read: false,
	};

    for (var i in attr)
    {
	var modifier = '';
	var name = i;

	if (endsWith( name, '+') || endsWith( name, '?' ) || endsWith( name, '*' ))
	{
	    modifier = name.substring( name.length - 1 );
	    name = name.substring( 0, name.length - 1 );
	}
	if (startsWith( name, '<-' ))
	{
	    if (level)
		throw new Error();

	    var r = innerParse( attr[ i ], true );

	    r.modifier = modifier;
	    name = name.substring( 2 );
	    res.inRels[ name ] = r;
	}
	else if (startsWith( name, '->' ))
	{
	    if (level)
		throw new Error();

	    var r = innerParse( attr[ i ], true );

	    r.modifier = modifier;
	    name = name.substring( 2 );
	    res.outRels[ name ] = r;
	}
	else if (startsWith( name, 'u_' ))
	{
	    if (name == 'u_read' && modifier != '+' && modifier != '?')
		res.userRead = true;
	    else
		throw new Error();
	}
	else if (startsWith( name, '_'))
	{
	    if (name == '_online' && modifier != '+' && modifier != '?')
		res.userOnline = true;
	    else
		throw new Error();
	}
	else
	{
	    if (modifier == '+' || modifier == '?')
		throw Error();
	    res.attr[ name ] = modifier;
	}
    }
    return res;
};


function startsWith( haystack, needle )
{
    return haystack.substring( 0, needle.length ) == needle;
}

function endsWith( haystack, needle )
{
    return haystack.length >= needle.length
        && haystack.substring( haystack.length - needle.length ) == needle;
}

exports.parse = parse;