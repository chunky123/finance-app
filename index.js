var express = require('express')
var app = express();
var ftp = require('ftp-get');
var fs = require('fs');
var stream = require('stream');
var readline = require('readline');
var util = require('util');
var _ = require('lodash');
var async = require('async');
require('colors');

var pg = require('pg');
// var conString = process.env.DATABASE_URL ||  "postgres://localhost:5432/finance";

conString = "postgres://localhost:5432/finance";
client = new pg.Client(conString);

app.set('port', (process.env.PORT || 5000))

app.use(express.static(__dirname + '/public'))

// This updates the nasdaq symbols in the market and stores them in a csv file for use
app.get('/update_nasdaq_symbols', function(request, response) {
  	var url = 'ftp://ftp.nasdaqtrader.com/SymbolDirectory/nasdaqtraded.txt';
	ftp.get(url, 'private/nasdaqtraded.txt', function (err, res) {
		if (err) {
	        console.error(err);
	    } else {
			console.log('File download at ' + res);
	    }
	});
	var symbols = [];
	var data = fs.readFileSync('./private/nasdaqtraded.txt','utf-8');
	var lines = data.split("\n");
	var tracker = 0;
	var stringsymbols = "";
	lines.forEach(function(line) {
	  custom_async(line, function(){
	  	tracker++;
	  	if (line.substr(0,1) === "Y") {
	    	var bar = line.substr(2,line.length).indexOf("|");
	    	symbols.push(line.substr(2, bar));
	    	stringsymbols += line.substr(2,bar) + "\n"; 
	    }
	    if(tracker === lines.length ) {
	      	var stuff = loadYahooData(symbols);
	    }
	  })
	});
});

app.get('/', function(request, response) {
  // response.send('This lists current stock symbols with given criteria');

  // populateSymbols(); // used for coping manual symbols to db
  // populateHistorical(); // gets all historical data

  // populateDifference(); // makes up for database difference and current day pricing

  // parse and output for now, later make it downloadable

  var resp = searchAndFilter(response);
  response.send(resp);



});

app.listen(app.get('port'), function() {
  	console.log("Node app is running at localhost:" + app.get('port'))

});

function getYearMonth(yearValue, monthValue) {
	if (monthValue <= 0) {
		var temp = ("0" + (12 - (monthValue + 1)));
		temp = temp.substr(temp.length-2);
		yearValue = yearValue - 1;
		return yearValue + "-" + temp;
	} else {
		return yearValue + ("0" + monthValue).substr(monthValue.length-2);
	}
}


function searchAndFilter(response) {
	// Current strategy: LONG TERM BOTTOM UP
	var potentialStocks = [];

	var now = new Date();
	var dateFormat = require('dateformat');
	var now = dateFormat(now, "isoDate");
	var pastYear = (parseInt(now.substr(0,4)) - 1) + now.substr(4);
	var pastTwoYear = (parseInt(now.substr(0,4)) - 2) + now.substr(4);
	var pastFiveYear = (parseInt(now.substr(0,4)) - 5) + now.substr(4);
	var threeMonths = getYearMonth(parseInt(now.substr(0,4)), parseInt(now.substr(5,7)) - 3) + now.substr(7);
	var q = "SELECT DISTINCT symbol FROM symbols";
	var oneYearHighQ = "SELECT max(adjClose) as adjClose FROM historical WHERE date >= '" + pastYear + "'";// symbol = '"
	// var oneYearHighQ = "SELECT max(adjClose) as adjClose FROM historical WHERE date >= '" + pastTwoYear + "'";// symbol = '"
	// var yearLowQ = "SELECT min(adjClose) as adjClose, date FROM historical WHERE date >= '" + pastYear + "'";// symbol = '";
	var fiveYearHighLowQ = "SELECT max(adjClose) as adjCloseH, min(adjClose) as adjCloseL FROM historical WHERE date >= '" + pastFiveYear + "'";
	var fourYearHighLowQ = "SELECT max(adjClose) as adjCloseH, min(adjClose) as adjCloseL FROM historical WHERE date >= '" + pastFiveYear + "' AND date <= '" + pastTwoYear + "'";
	var currClosePriceQ = "SELECT adjClose FROM historical WHERE date <= '" + now + "'";

	var threeMonthHighLowQ = "SELECT max(adjClose) as adjCloseH, min(adjClose) as adjCloseL FROM historical WHERE date >= '" + threeMonths + "'";
	client.connect();
	var newClient = new pg.Client("postgres://localhost:5432/finance"); 
	newClient.connect();

	var yearHighQ = "adjClose = (SELECT MAX(adjClose) as adjClose FROM historical where date >= '" + pastTwoYear + "' AND symbol='";
	var yearLowQ = "adjClose = (SELECT MIN(adjClose) as adjClose FROM historical where date >= '" + pastTwoYear + "' AND symbol='";
	// query all syms
	var generalq = client.query(q);
	var output = "";
	var csvoutput = "";
	var count = 0;

	var YQL = require('yql');
	
	generalq.on('row', function(symout) {

		async.parallel({
		    res1: function(callback) {
		    	// console.log("res1");
		    	newClient.query("SELECT adjClose, date FROM historical WHERE symbol = '" 
		    		+ symout.symbol + " ' AND " + yearLowQ + symout.symbol + "');", function(err, res1) {
		        	callback(null, res1);
		    	});
		    },
		    res2: function(callback) {
		    	// console.log("res2");
				newClient.query("SELECT adjClose, date FROM historical WHERE symbol = '" 
					+ symout.symbol + " ' AND " + yearHighQ + symout.symbol + "');", function(err, res2) {
		        	callback(null, res2);
				});
		    },
		    res3: function(callback) {
		    	// console.log("res3");
				newClient.query(fourYearHighLowQ + " AND symbol = '" + symout.symbol + " ';", function(err, res3) {
		        	callback(null, res3);
				});
		    },
		    res4: function(callback) {		
		    	// console.log("res4");	  			
		    	newClient.query(currClosePriceQ + " AND symbol = '" + symout.symbol + "' ORDER BY date DESC LIMIT 1;", function(err, res4) {    	
			        callback(null, res4);
			    });
		    },
		    res5: function(callback) {
		    	// console.log("res5");
				newClient.query(fiveYearHighLowQ + " AND symbol = '" + symout.symbol+ " ';", function(err, res5) {
		        	callback(null, res5);
				});
		    },
		    res6: function(callback) {
		    	// console.log("res6");
				newClient.query("SELECT count(DISTINCT symbol) FROM symbols ;", function(err, res6) {
		        	callback(null, res6);
				});
		    },
		    res7: function(callback) {
		    	// console.log("res7");
				newClient.query(oneYearHighQ + " AND symbol = '"  + symout.symbol + " ';", function(err, res7) {
		        	callback(null, res7);
				});
		    },
		    response: function(callback) {
				var query = new YQL("select * from csv where url='http://download.finance.yahoo.com/d/quotes.csv?s=" + symout.symbol.trim() + '&f=m6\'');
				query.exec(function (error, response) {
					callback(null, response);
				});
		    }
		}, function (err, result) {
			var res1 = result.res1;
			var res2 = result.res2;
			var res3 = result.res3;
			var res4 = result.res4;
			var res5 = result.res5;
			var res6 = result.res6;
			var res7 = result.res7;
			var response = result.response;
			
			if (response === null) {
				console.log("YQL Query Error");
				count++;
			} else if (response.query.results != null) {
			    var quote = response.query.results.row;
			    var capstring = quote;

			    if (capstring != null) {
			    	// This is the change between the current price and the 200 day moving average 
				    var percentagetwohundredMA = parseInt(capstring.col0.substr(0,capstring.col0.length-1));
				    if (percentagetwohundredMA >= -5 && 
				    	percentagetwohundredMA <= 40 ) {
				    	// more conditions go here
				    	// TODO: Setup an easy method for meeting condiitions 
				    	// Probably consider writing a function that takes in parameters, changing conditions on them
				    	// This way, it is also possible to do some dynamic adjustments based on user preferences
					    // if res7.rows[0].adjclose < res4.rows[0].adjclose {
					    // 	console.log("True: " + res7.rows[0].adjclose + " < " + res4.rows[0].adjclose)
					    // }
					    // console.log("True: " + res7.rows[0].adjclose + " < " + res4.rows[0].adjclose)
					    
						if (typeof res1.rows[0] != 'undefined' 
							&& res2.rows[0] != 'undefined'
							&& res3.rows[0] != 'undefined'
							&& res4.rows[0] != 'undefined'
							&& res7.rows[0] != 'undefined')

					    if ( 	
				    		// For bull
				    		// 50% increase from one year low to one year high
				    		(res1.rows[0].adjclose * 1.5 < res2.rows[0].adjclose && 
				    		 res1.rows[0].date < res2.rows[0].date	) &&
				    		// 15% current price lower than 1 yr high
				    		// (res4.rows[0].adjclose < res2.rows[0].adjclose * 0.85) &&
				    		// first 4 year high price * 1.3 > 1yearhigh
				    		(res3.rows[0].adjcloseh * 1.3 > res7.rows[0].adjclose ) &&
				    		(res3.rows[0].adjclosel < res4.rows[0].adjclose)
							

							// Bear
							// half year instead of 1 year, 20-25 %
							// (res1.rows[0].adjclose >= (res5.rows[0].adjcloseh - res5.rows[0].adjclosel)*0.7 + res5.rows[0].adjclosel) //&&
							// (res5.rows[0].adjcloseh > 5 * res5.rows[0].adjclosel)

				    		// (res1.rows[0].adjclose < (res3.rows[0].adjcloseh * 0.5)) && 
				    		// (1.40 < (res2.rows[0].adjclose / res1.rows[0].adjclose)) && 
				    		// (res3.rows[0].adjclosel < res4.rows[0].adjclose) && 
				    		// (res4.rows[0].adjclose < (res3.rows[0].adjcloseh * 0.75)) &&
				    		// ((res5.rows[0].adjcloseh / res5.rows[0].adjclosel) < 1.20) &&
				    		// (res5.rows[0].adjclosel > res3.rows[0].adjclosel) &&
				    		// (res1.rows[0].adjclose > res3.rows[0].adjclosel)
				    		) {
					    	potentialStocks.push(symout.symbol);
						    console.log(symout.symbol);

							output += symout.symbol + ", ";
							csvoutput += symout.symbol + "\n";
					    }
					    count ++;
					    if (count == res6.rows[0].count) {
					    	// response.send(output.substr(0, output.length-1));
				    	 	fs.writeFile("./private/pickedstocks.csv", csvoutput, function(err) {
							    if(err) {
							        console.log(err);
							    } else {
									console.log("Completed writing stocks!");
							    }
							});
					    	newClient.end();
					    	client.end();
					    	return output;
					    }
					} else {
						count++;
					}	
				} else {
					console.log("CAPSTINRG IS NULL FOR: " + symout.symbol.trim());
					count++;
				}

		 	} else {
		 		console.log("Symbol is null: " + symout.symbol.trim());
		 		count++;
		 	}
		});
	});
};

// This function populates the database depending on the difference in days
// This should be run Daily
function populateDifference() {

	client.connect();
	var newClient = new pg.Client("postgres://localhost:5432/finance"); 
	newClient.connect();

	// Grabs most recent date
	var symbolsQuery = 'SELECT * FROM symbols';
	var mostRecentDateQuery = 'SELECT date FROM historical ORDER BY date DESC LIMIT 1';

	var yahooData = require('yahoo-finance');
	var now = new Date();
	var dateFormat = require('dateformat');
	var now = dateFormat(now, "isoDate");

	client.query(mostRecentDateQuery).on('row', function(row) {
		// Check if date is current, if NOT, query and make up the difference
		var lastDate = dateFormat(row.date, "isoDate");
		if (lastDate < now) {
			console.log("UPDATING WITH NEWER DATA");
			client.query(symbolsQuery).on('row', function(row) {
		    	yahooData.historical({
				  symbols: [ row.symbol ],
				  from: lastDate,
				  to: now,
				  // to: next, 
				  period: 'd'
				}, function (err, result) {
				  if (err) { throw err; }
				  _.each(result, function (quotes, symbol) {
				  	if (quotes[0]) {
				  		var nestedq = "INSERT INTO historical (date, open, high, low, close, volume, adjClose, symbol) VALUES ";
				  		for (var i = 0; i < quotes.length; i++) {
					  		// console.log(quotes[i]);
							var inp = [dateFormat(quotes[i].date, "isoDate"), quotes[i].open, quotes[i].high, quotes[i].low, quotes[i].close, quotes[i].volume, quotes[i].adjClose, quotes[i].symbol];
							nestedq += " ( "
							for (var j = 0; j < inp.length; j++) {
								if (j+1 == inp.length) {
									nestedq += "'" + inp[j] + "'";
								} else {
									nestedq += "'" + inp[j] + "', ";
								}
							}
							nestedq +=" ), "
				  		}
						var newQ = newClient.query(nestedq.substr(0,nestedq.length-2) + ";", function(err, res) {
				  			if (err) { console.log(nestedq.substr(0,nestedq.length-2)) };
							console.log("Inserted Symbol: " + quotes[0].symbol);
				  		});
				  	}
				  });
				});
			});
		}
	});		 
	newClient.on('end', function(){
		console.log("DONE");
		newClient.end();
	});
};

// manually populates all of the symbols from the csv into the database
function populateSymbols() {
	var q = 'COPY symbols FROM \'/Users/chengpeng123/Documents/finance-app/private/manualsymbols.csv\' WITH CSV;';

	pg.connect(conString, function(err, client, done) {
	   client.query(q, function(err, result) {
	      done();
	      if(err) return console.error(err);
	      console.log("Completed importing symbols");
	   });
	});
};

// Custom async function
function custom_async(arg, callback) {
  setTimeout(function() { callback(arg); }, 10);
};

// Takes a list of symbols, and queries data from Yahoo website
function loadYahooData(SYMBOLS) {
	var YQL = require('yql');
	var newSymbols = [];
	var tracker = 0;
	var stringsymbols = "";
	SYMBOLS.forEach(function(SYMBOL) {
	  custom_async(SYMBOL, function(results){
	  	var query = new YQL('select * from yahoo.finance.quote where symbol = \'' + SYMBOL + '\'');
		query.exec(function (error, response) {
		  	tracker++;
			if (error) {

			} else if (response.query.results != null) {
			    var quote = response.query.results.quote;
			    var percentageChange = parseFloat(quote.YearLow) / parseFloat(quote.LastTradePriceOnly);
			    var marketCap;
			    var capstring = quote.MarketCapitalization;

			    if (capstring == null) {
			    	
			    } else if ( capstring.indexOf("M") > 0) {
			    	marketCap = parseFloat(capstring.substring(0, capstring.length-2)) * 1000;

			    } else if ( capstring.indexOf("B") > 0) {
			    	marketCap = parseFloat(capstring.substring(0, capstring.length-2)) * 1000000;
			    }
			    if (capstring != null) {
				    var glico = marketCap * percentageChange;
				    var threemonthvolume = parseInt(quote.AverageDailyVolume);
				    var price = parseFloat(quote.LastTradePriceOnly);

				    if (marketCap > 500000 && threemonthvolume > 50000 && price > 2) {
				    	// remove from SYMBOLS
				    	newSymbols.push(SYMBOL);
				    	console.log(SYMBOL);
				    	stringsymbols+= SYMBOL + "\n";
					} else {

					}

					console.log(SYMBOLS.length + " : " + tracker);
					if (SYMBOLS.length === tracker ) {
						console.log("FINISHED PARSING ALL");
						fs.writeFile("./private/nasdaqsymbols.csv", stringsymbols, function(err) {
						    if(err) {
						        console.log(err);
						    } else {
								console.log("Writing filteredSymbols");
						    }
						}); 
						return newSymbols;
					}
				}
			}
		});
	  });
		
	});
};

// This only populates all of the historical data from 5 years ago, only needs to be ran once to populate database.
function populateHistorical() {	
	// select a symbol from database
	// import historical data

	var yahooData = require('yahoo-finance');
	var now = new Date();
	var dateFormat = require('dateformat');
	var now = dateFormat(now, "isoDate");

	var years = 5;
	var past = (parseInt(now.substr(0,4)) - years) + now.substr(4);
	var q = 'SELECT * FROM symbols where symbol > \'ZLTQ\'';
	var newClient = new pg.Client("postgres://localhost:5432/finance");
	newClient.connect();
	client.connect();

    var query = client.query(q);

    query.on('row', function(row) {
    	yahooData.historical({
		  symbols: [ row.symbol ],
		  from: past,
		  to: now,
		  period: 'd'
		}, function (err, result) {
		  if (err) { throw err; }
		  _.each(result, function (quotes, symbol) {
		  	if (quotes[0]) {
		  		var nestedq = "INSERT INTO historical (date, open, high, low, close, volume, adjClose, symbol) VALUES ";
		  		for (var i = 0; i < quotes.length; i++) {
			  		// console.log(quotes[i]);
					var inp = [dateFormat(quotes[i].date, "isoDate"), quotes[i].open, quotes[i].high, quotes[i].low, quotes[i].close, quotes[i].volume, quotes[i].adjClose, quotes[i].symbol];
					nestedq += " ( "
					for (var j = 0; j < inp.length; j++) {
						if (j+1 == inp.length) {
							nestedq += "'" + inp[j] + "'";
						} else {
							nestedq += "'" + inp[j] + "', ";
						}
					}
					nestedq +=" ), "
		  		}
				var newQ = newClient.query(nestedq.substr(0,nestedq.length-2) + ";", function(err, res) {
		  			if (err) { console.log(nestedq.substr(0,nestedq.length-2)) };
					console.log("Inserted Symbol: " + quotes[0].symbol);

		  		});
		  	}
		  });
		});
	});
	newClient.on('end', function(){
		console.log("DONE");
		newClient.end();
	});
	query.on('end', function() { 
	  client.end();
	});
};

