#!/usr/bin/env node

/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';

import * as chromeLauncher from 'chrome-launcher';
import Table from 'cli-table3';
import colors from 'colors';
import { format } from 'date-fns';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import fetch from 'node-fetch';
import slugify from 'slugify';

const DEFAULT_RESULTS_DIR = 'lighthouse-reports';

/**
 * Get configuration from file specified when executing script.
 *
 * Supports groups with different config options. Merged with top level config. .
 *
 * @returns {Array} Config file.
 */
function getConfig() {
	const configFile = path.resolve( process.argv[2] );

	if ( ! fs.existsSync( configFile ) ) {
		console.error( colors.red( 'Error: Config file not found.' ) );
		process.exitCode = 1;
		return;
	}

	const config = JSON.parse( fs.readFileSync( configFile ) );

	const group = process.argv[3] || Object.keys( config.urls )[0];

	if ( config.groups && group in config.groups ) {
		return {
			...config,
			...config.groups[ group ],
		};
	} else {
		return config;
	}
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
async function runTestsForUrlLighthouse( strategy, url  ) {
	const config = getConfig();
	const defaultData = {
		url,
		strategy,
		lighthouse: {},
	};

	const categories = Object.keys( config.categories );
	if ( ! categories?.length ) {
		return defaultData;
	}

	const testUrl = new URL( url );
	Object.keys( config.searchParams || {} ).forEach( param => {
		testUrl.searchParams.append( param, config.searchParams[ param ] );
	} );

	const chrome = await chromeLauncher.launch( { chromeFlags: [ '--headless' ] } );

	const flags = {
		logLevel: 'warn',
		output: 'json',
		onlyCategories: categories,
		port: chrome.port,
	};

	const lighthouseConfig = strategy === 'desktop' ? desktopConfig : { extends: 'lighthouse:default' };

	const { lhr: lighthouseResult } = await lighthouse( testUrl.toString(), flags, lighthouseConfig );

	await chrome.kill();

	if ( ! lighthouseResult ) {
		console.error( colors.red( `Error. Failed to retrieve result for ${ testUrl.toString() } - ${ strategy }` ) );
		return defaultData;
	}

	writeResultsFile(
		`${ format( new Date(), 'yyyy-MM-dd' ) }-${ slugify( url.replace( /https?:\/\//, '' ).replace( '/', '-' ) ) }-${ strategy }`,
		lighthouseResult
	);

	return {
		...defaultData,
		lighthouse: Object.entries( lighthouseResult.categories ).reduce( ( scores, [ category, { score = 0 } ] ) => {
			scores[ category ] = score * 100;
			return scores;
		}, {} ),
	};
}

/**
 * Run tests for a single URL.
 *
 * @param {string} url - Test URL.
 * @param {string} strategy - Testing strategy (e.g., "mobile").
 * @returns {object} Results data as JSON.
 */
async function runTestsForUrlPagespeed( strategy, url ) {
	const config = getConfig();
	const defaultData = {
		url,
		strategy,
		lighthouse: {},
	};

	const categories = Object.keys( config.categories );
	if ( ! categories?.length ) {
		return defaultData;
	}

	const testUrl = new URL( url );
	Object.keys( config.searchParams || {} ).forEach( param => {
		testUrl.searchParams.append( param, config.searchParams[ param ] );
	} );

	const requestUrl = new URL( 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' );
	requestUrl.searchParams.append( 'url', testUrl.toString() );
	requestUrl.searchParams.append( 'strategy', strategy );

	categories.forEach( category => {
		requestUrl.searchParams.append( 'category', category );
	} );

	if ( config.googleApiKey ) {
		requestUrl.searchParams.append( 'key', config.googleApiKey );
	}

	let response;

	console.log( requestUrl.toString() );

	try {
		const rawResponse = await fetch( requestUrl.toString() );
		response = await rawResponse.json();
	} catch ( err ) {
		console.error( colors.red( err.toString() ) );
		return defaultData;
	}

	const { lighthouseResult } = response;

	if ( ! lighthouseResult ) {
		console.error( colors.red( `Error. Failed to retrieve result for ${ testUrl.toString() } - ${ strategy }` ) );
		console.error( colors.red( `${ requestUrl.toString() }` ) );
		console.error( response );
		return defaultData;
	}

	writeResultsFile(
		`${ format( new Date(), 'yyyy-MM-dd' ) }-${ slugify( url.replace( /https?:\/\//, '' ).replace( '/', '-' ) ) }-${ strategy }`,
		lighthouseResult
	);

	return {
		...defaultData,
		lighthouse: Object.entries( lighthouseResult.categories ).reduce( ( scores, [ category, { score = 0 } ] ) => {
			scores[ category ] = score * 100;
			return scores;
		}, {} ),
	};
}

/**
 * Format test result.
 *
 * @param {number} score - Test result out of 100.
 * @param {number} category - Threshold for passing.
 * @param {number} strategy - Threshold for failing.
 * @returns {string} Score, but colored.
 */
function formatResult( score, category, strategy ) {
	const config = getConfig();
	const threshold = config.categories?.[ category ]?.threshold?.[ strategy ] || 90;
	const lowerThreshold = config.categories?.[ category ]?.lowerThreshold?.[ strategy ] || 50;

	if ( score >= threshold ) {
		return colors.green( `✅ ${ Math.round( score ) }` );
	} else if ( score >= lowerThreshold ) {
		return colors.yellow( `🆗 ${ Math.round( score ) }` );
	} else {
		return colors.red( `❌ ${ Math.round( score ) }` );
	}
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
	const categories = Object.keys( config.categories );
	const urls = results.map( result => result.url );

	const table = new Table( {
		style: {
			border: [],
			header: [],
		},
		head: [
			'URL',
			...categories.map( category => category.toUpperCase() ),
		],
	} );

	results.forEach( ( result, index ) => {
		table.push( [
			urls[ index ],
			...categories.map( category => formatResult( result.lighthouse[ category ], category, strategy ) ),
		] );
	} );

	return table.toString();
}

/**
 * Get pagespeed results.
 *
 * Runs tests in batches. 400 by default.
 * Configuring this is useful to avoid running into rate limits or similar.
 *
 * @param {Array}  strategies Strategies to test for (e.g mobile)
 * @param {Array}  urls       URLs to test.
 *
 * @returns {Promise} Resolves to an array of arrays where subarrays are results of a strategy for the tested URLs.
 */
async function runPagespeed( strategies, urls ) {
	const config = getConfig();
	const batchSize = ( 'batchSize' in config && config.batchSize > 0 ) ? config.batchSize : 400;
	const allResults = [];

	for ( let i = 0; i < strategies.length; i++ ) {
		const strategy = strategies[i];
		const strategyResults = [];

		for ( let j = 0; j < urls.length; j += batchSize ) {
			const batch = urls.slice( j, j + batchSize );
			console.log( batch );
			const batchResults = await Promise.all( batch.map( url => runTestsForUrlPagespeed( strategy, url ) ) );
			strategyResults.push( ...batchResults );
		}

		allResults.push( strategyResults );
	}

	return new Promise( resolve => {
		resolve( allResults );
	} );
}

/**
 * Run tests for all urls and strategies using the lighthouse engine.
 *
 * @param {Array} strategies Strategies e.g. desktop, mobile.
 * @param {Array} urls URLs.
 * @returns {Array} Results.
 */
async function runLighthouse( strategies, urls ) {
	const allResults =[];
	for ( const strategy of strategies ) {
		const strategyResults = [];
		for ( const url of urls ) {
			strategyResults.push( await runTestsForUrlLighthouse( strategy, url ) );
		}
		allResults.push( strategyResults );
	}

	return allResults;
}

/**
 * Execute.
 */
( async () => {
	const config = getConfig();
	const { categories, engine = 'pagespeed', strategies, urls } = config;

	if ( ! urls?.length ) {
		console.error( colors.red( 'Error: No URLs specified.' ) );
		process.exitCode = 1;
		return;
	}

	if ( ! strategies?.length ) {
		console.error( colors.red( 'Error: No strategies specified.' ) );
		process.exitCode = 1;
		return;
	}

	if ( [ 'pagespeed', 'lighthouse' ].indexOf( engine ) < 0 ) {
		console.error( colors.red( 'Error: Engine not supported. Expected pagespeed or lighthouse' ) );
		process.exitCode = 1;
	}

	let allResults;

	if ( engine === 'pagespeed' ) {
		allResults = await runPagespeed( strategies, urls );
	} else {
		allResults = await runLighthouse( strategies, urls );
	}

	let hasFailures = false;

	strategies.forEach( ( strategy, index ) => {
		const results = allResults[ index ];

		// Output table.
		console.log( colors.blue( strategy.toUpperCase() ) );
		console.log( getResultsTable( results, strategy ) );

		const { fail = 0, total = 0 } = results.reduce( ( tests, result ) => {
			const lighthouseResult = Object.entries( result.lighthouse );
			if ( lighthouseResult.length === 0 ) {
				// All category tests considered failed.
				const totalCategories = Object.keys( categories ).length;
				tests.fail += totalCategories;
				tests.total += totalCategories;
			} else {
				lighthouseResult.forEach( ( [ category, score ] ) => {
					tests.total++;

					if ( score < ( config.categories?.[ category ]?.threshold?.[ strategy ] || 90 ) ) {
						tests.fail++;
					}
				} );
			}

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
