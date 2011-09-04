var http = require('http');
var url = require('url');
var fs = require('fs');
var sys    = require('sys');
var path = require('path');

function startsWith( haystack, needle )
{
    return haystack.substring( 0, needle.length ) == needle;
}

function endsWith( haystack, needle )
{
    return haystack.length >= needle.length
        && haystack.substring( haystack.length - needle.length ) == needle;
}

function exists( path )
{
    try
    {
	return fs.lstatSync( path ) != null;
    }
    catch (e)
    {
    	return false;
    }
}

if (process.argv.length < 3)
{
    console.log("usage: node server.js <appname>");
    process.exit(-1);
}

appName = process.argv[2];
appRoot = path.resolve( path.join( '..', appName ) );

serverRoot = path.resolve();

if (!path.existsSync(appRoot))
{
    console.log('no such app: "' + appName + '"');
    process.exit(-1);
}

configFilename = path.join( appRoot, 'app.json' );
config = JSON.parse(fs.readFileSync(configFilename));

// TODO: Should validate the full config here

dependencyFiles = [];
for (var i=0; i < config.dependencies.length; i++)
{
    // TODO: Special url prefix for these?
    var filename = config.dependencies[i];
    dependencyFiles.push(filename+'.js');
}

dbFile = appName;

var server = http.createServer(function (req, res) {
    var uriPath = url.parse(req.url).pathname;

    if (uriPath == '/')
    {
	res.writeHead(200, {'Content-Type': 'text/html'});
	res.write('<h1>Welcome. Try the <a href="/forum/">forum</a> app.</h1>');
	res.end();
	return;
    }
    else if (startsWith( uriPath, '/forum/' ))
    {
	var contentType;

	uriPath = uriPath.substring( '/forum/'.length );
	if (uriPath == '')
	{
	    var html="";
	    var files = fs.readdirSync( "../forum/" );

	    html += '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n';
	    html += '<html xmlns="http://www.w3.org/1999/xhtml">\n';
	    html += '  <head>\n';
	    html += '    <title>Forum. App. Enjoy.</title>\n';
	    for (var i=0; i < config.stylesheets.length; i++)
	        html += '    <link rel="stylesheet" type="text/css" href="'+config.stylesheets[i]+'" />\n';
	    html += '  <script type="text/javascript" src="/socket.io/socket.io.js"></script>\n';
	    html += '  <script type="text/javascript" src="api.js"></script>\n';
	    for (var i=0; i < files.length; i++)
		if (endsWith( files[i], ".js" ))
		    html += '  <script type="text/javascript" src="' + files[i] + '"></script>\n';
	        else if (endsWith( files[i], ".css" ))
		    html += '  <link rel="stylesheet" type="text/css" href="' + files[i] + '" >\n';
	    for (var i=0; i < dependencyFiles.length; i++)
	    {
	        filename = dependencyFiles[i];
	        html += '  <script type="text/javascript" src="' + filename + '"></script>\n';
	    }
	    html += '  <script type="text/javascript">\n';
	    html += 'var liveDb = new LiveDB( );\n';
	    html += '\n';
	    html += 'function login()\n';
	    html += '{\n';
	    html += '  liveDb.login( loginCallback, document.getElementById( "login" ).value );\n';
	    html += '}\n';
	    html += '\n';
	    html += 'function loginCallback( query )\n';
	    html += '{\n';
//	    html += '  console.log("logging in!");';
	    html += '  if (query != "success")\n';
	    html += '    return;\n';
	    html += '  onLoad( liveDb, "content" );\n';
	    html += '}\n';
	    html += '  </script>\n';
	    html += '</head>\n';
	    html += '<body>\n';
	    html += '  <div id="content">\n';
	    html += '    <input type="text" id="login" size="20" />\n';
	    html += '    <button onclick="login()">Login</button>\n';
	    html += '  </div>\n';
	    html += '</body>\n';
	    html += '</html>\n';
	    contentType = "text/html";
	    res.writeHead( 200, {'Content-Type': contentType});
	    res.write( html );
	    res.end();
	    return;
	}
	else if (endsWith( uriPath, ".html" ))
	    contentType = "text/html";
	else if (endsWith( uriPath, ".js" ))
	    contentType = "text/javascript";
	else if (endsWith( uriPath, ".css" ))
	    contentType = "text/css";
	else if (endsWith( uriPath, ".png" ))
	    contentType = "image/png";
	else if (endsWith( uriPath, ".jpeg" ))
	    contentType = "image/jpeg";
	else
	    contentType = "application/octet-stream";

	if (exists( path.join( serverRoot, "../api/" + uriPath ) ))
	{
	    res.writeHead( 200, {'Content-Type': contentType});
	    res.write( fs.readFileSync( path.join( serverRoot, "../api/" + uriPath ) ) );
	    res.end();
	    return;
	}
	else if (exists( path.join( serverRoot, "../../lib/" + uriPath ) ))
	{
	    res.writeHead( 200, {'Content-Type': contentType});
	    res.write( fs.readFileSync( path.join( serverRoot, "../../lib/" + uriPath ) ) );
	    res.end();
	    return;
	}
	else if (exists( path.resolve( appRoot, uriPath ) ))
	{
	    res.writeHead( 200, {'Content-Type': contentType});
	    res.write( fs.readFileSync( path.resolve( appRoot, uriPath ) ) );
	    res.end();
	    return;
	}
    }
    res.writeHead( 404 );
    res.write( "File not found" );
    res.end();
});

server.listen(8124, "127.0.0.1");

db = require("./database");
dbMgr = new db.DatabaseManager(server, dbFile, function (error)
			       {
				   if (error)
				       return;
				   if (config.db)
				   {
				       for (var i in config.db)
				       {
					   dbMgr.mkdirp( config.db[i] );
				       }
				   }
				   console.log( 'Server running at http://127.0.0.1:8124/' );
			       } );
