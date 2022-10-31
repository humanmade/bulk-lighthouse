#!/usr/bin/env node

/* eslint-disable no-console */

const fs = require( 'fs' );
const path = require( 'path' );

const Table = require( 'cli-table3' );
const colors = require( 'colors' );
const { format } = require( 'date-fns' );
const fetch = require( 'node-fetch' );
const slugify = require( 'slugify' );

const DEFAULT_RESULTS_DIR = 'lighthouse-reports';

/**
 * Get configuration from file specified when executing script.
 *
 * @returns {Array} Config file.
 */
function getConfig() {
	const configFile = path.resolve( process.argv[1] );
	if ( ! fs.existsSync( configFile ) ) {
		console.error( colors.red( 'Error: Config file not found.' ) );
		process.exitCode = 1;
		return;
	}
	return require( configFile );
}

/**
 * Get URLs from config for urlGroup.
 *
 * @param {string} urlGroup Group.
 * @returns {Array} Suite of URLs to test.
 */
function getUrls( urlGroup ) {
	const config = getConfig();
	return config.urls[ urlGroup ] || Object.values( config.urls )[0] || [];
}

/**
 * Write results file.
 *
 * Creates the results directory if it doesn't exist.
 *
 * @param {string} fileName - File name.
 * @param {object} resultsData - Results data as JSON.
 */
function writeResultsFile( fileName, resultsData ) {
	const config = getConfig();
	const dirName = config.resultsDir || DEFAULT_RESULTS_DIR;
	const dir = process.cwd() + '/' + dirName;

	if ( ! fs.existsSync( dir ) ){
		fs.mkdirSync( dir );
	}

	fs.writeFileSync(
		`${dir}/${ fileName }.json`,
		JSON.stringify( resultsData, null, '\t' )
	);
}

/**
 * Run tests for a single URL.
 *
 * @param {string} url - Test URL.
 * @param {string} strategy - Testing strategy (e.g., "mobile").
 * @returns {object} Results data as JSON.
 */
async function runTests( url, strategy ) {
	const config = getConfig();
	const returnData = {
		url,
		strategy,
		tests: {},
	};

	const categories = Object.keys( config.categories );
	if ( ! categories?.length ) {
		return returnData;
	}

	const testUrl = new URL( url );
	Object.keys( config.searchParams ).forEach( param => {
		testUrl.searchParams.append( param, config.searchParams[ param ] );
	} );

	// Make a request to the page URL
	// This ensures page is cached, which ensures more consistent results.
	try {
		await fetch( testUrl.toString() );
	} catch ( err ) {
		console.error( colors.red( 'Cache prime request failed' ) );
	}

	const requestUrl = new URL( 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' );
	requestUrl.searchParams.append( 'url', testUrl.toString() );
	requestUrl.searchParams.append( 'strategy', strategy );

	categories.forEach( category => {
		requestUrl.searchParams.append( 'category', category );
	} );

	if ( config.googleAPIKey ) {
		requestUrl.searchParams.append( 'key', config.googleAPIKey );
	}

	let response;

	try {
		const rawResponse = await fetch( requestUrl.toString() );
		response = await rawResponse.json();
	} catch ( err ) {
		console.error( colors.red( err.toString() ) );
		return returnData;
	}

	const { lighthouseResult } = response;

	if ( ! lighthouseResult ) {
		console.error( colors.red( `Error. Failed to retrieve result for ${ testUrl.toString() } - ${ strategy }` ) );
		console.error( colors.red( `${ requestUrl.toString() }` ) );
		console.error( response );
		return returnData;
	}

	writeResultsFile(
		`${ format( new Date(), 'yyyy-MM-dd' ) }-${ slugify( url.replace( /https?:\/\//, '' ) ) }-${ strategy }`,
		lighthouseResult
	);

	return {
		...returnData,
		tests: Object.entries( lighthouseResult.categories ).reduce( ( scores, [ category, { score = 0 } ] ) => {
			scores[ category ] = score * 100;
			return scores;
		}, {} ),
	};
}

/**
 * Format test result.
 *
 * @param {number} score - Test result out of 100.
 * @param {number} threshold - Threshold for passing.
 * @returns {string} Score, but colored.
 */
function formatResult( score, threshold ) {
	return score >= threshold ? colors.green( `✅ ${ Math.round( score ) }` ) : colors.red( `❌ ${ Math.round( score ) }` );
}

/**
 * Create a table to display results.
 *
 * @param {object} results - Results as JSON.
 * @param {string} strategy - Strategy. mobile or desktop.
 * @returns {string} Results table as string.
 */
function getResultsTable( results, strategy ) {
	const config = getConfig();
	const categories = Object.entries( config.categories );

	const urls = results.map( result => result.url );

	const table = new Table( {
		style: {
			border: [],
			header: [],
		},
		head: [
			'URL',
			...categories.map( ( [ category, { threshold } ] ) => `${ category.toUpperCase() } (${ threshold[ strategy ] })` ),
		],
	} );

	results.forEach( ( result, index ) => {
		table.push( [
			urls[ index ],
			...categories.map( ( [ category, { threshold } ] ) => formatResult( result.tests[ category ], threshold[ strategy ] ) ),
		] );
	} );

	return table.toString();
}

/**
 * Execute.
 */
 ( async () => {
	const config = getConfig();
	const urlGroup = process.argv[2];

	if ( ! urlGroup ) {
		console.error( colors.red( 'Error: No urlGroup specified. Script usage e.g. `node lighthouse production`' ) );
		process.exitCode = 1;
		return;
	}

	const urls = getUrls( urlGroup );
	if ( ! urls?.length ) {
		console.error( colors.red( 'Error: No URL specified.' ) );
		process.exitCode = 1;
		return;
	}

	const { strategies } = config;
	if ( ! strategies?.length ) {
		console.error( colors.red( 'Error: No strategies specified.' ) );
		process.exitCode = 1;
		return;
	}

	const { categories } = config;

	let hasFailures = false;

	// Run tests concurrently.
	const allResults = await Promise.all(
		strategies.map( strategy => Promise.all( urls.map( test => runTests( test, strategy ) ) ) )
	);

	strategies.forEach( ( strategy, index ) => {
		const results = allResults[ index ];

		// Output table.
		console.log( colors.blue( strategy.toUpperCase() ) );
		console.log( getResultsTable( results, strategy ) );
		console.log();

		const { fail = 0, total = 0 } = results.reduce( ( tests, result ) => {
			Object.entries( result.tests ).forEach( ( [ category, score ] ) => {
				tests.total++;
				if ( score < categories[ category ].threshold ) {
					tests.fail++;
				}
			} );

			return tests;
		}, {
			fail: 0,
			total: 0,
		} );

		// Display failures.
		if ( fail ) {
			hasFailures = true;

			if ( fail === total ) {
				console.error( colors.red( 'All tests failed!' ) );
			} else {
				console.error( colors.red( `${ fail }/${ total } tests failed!` ) );
			}
		} else {
			console.log( colors.green( 'All tests passed.' ) );
		}

		console.log();
	} );

	// Set correct exit code.
	if ( hasFailures ) {
		process.exitCode = 1;
	}
} )();
