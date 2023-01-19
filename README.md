# Bulk Lighthouse Tests.

Run bulk lighthouse tests using [Google PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/about).

Define several URLs for significant pages on your site, and run tests against them all easily. The results are displayed in your console, and also saved in a file as JSON so that you can save for future reference.

## Getting Started 

### Installation

From your project directory, run: 

```
npm i @humanmade/bulk-lighthouse --save-dev
```

## Running the script. 

```
bulk-lighthouse .config/lighthouse.json
```

* Param 1. Path to config file. (see below for more info)
* Param 2. (optional) Group of URLs to run tests against as specified in config under `urls`.

It is recommended that you add a command to execute this to the `scripts` object in your project package.json for ease of use. To run as a one-off, use `npm run env -- bulk-lighthouse .config/lighthouse.json`.

## Configuration.

Here is a basic config JSON file that you can copy/paste to get started. 

```
{
	"categories": {
		"performance": {
			"threshold": {
				"desktop": 90,
				"mobile": 70
			}
		},
	},
	"strategies": [
		"mobile",
		"desktop"
	],
	"urls": {
		"production": [
			'http://example.com
		],
	}
}
```

See below for all of the supported options. 

## Configuration Options. 

**`googleApiKey`**: Optional. See https://developers.google.com/speed/docs/insights/v5/get-started to generate an API key. Providing one will ensure that you don't hit rate limits.

**`searchParams`** Object. Optional. Add search params to the URL you're running the tests against. This can be used to pass keys for authentication.

**`categories`** Required. Object. Tests to run. Provide a pass/fail threshold for each test. Specify a different threshold for each environment. The following config will run only the performance test.  See https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed#Category.

```
"categories": {
	"performance": {
		"threshold": {
			"desktop": 90,
			"mobile": 70
		}
	},
	"accessibility": {
		"threshold": {
			"desktop": 90,
			"mobile": 90
		}
	},
	"seo": {
		"threshold": {
			"desktop": 90,
			"mobile": 90
		}
	},
},
```

**`strategies`** Required. Array. The device running strategy to be used in analysis. Both, or one of `desktop` or `mobile`. See https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed#strategy

**`urls`**. Required. Group URLs (e.g. by environment). Specify the group of URLs to run when executing the script e.g. `node .scripts/lighthouse.js staging`. If no group is specified, the first one configured will be used.

```
"urls": {
	"production": [
		"https://example.com/",
		"https://example.com/about",
	],
	"staging": [
		"https://staging.example.com/",
		"https://staging.example.com/about",
	]
}
```

**`resultsDir`** Optional. Directory in which to save results as JSON. Defaults to `lighthouse-reports`.

**`batchTests`** Optional. Whether to run the tests in batches. Set to `true` for tests to be batched otherwise remove or set to `false` to run all tests concurrently.

**`batchSize`** Optional. The number of URLs to include in each batch. Defaults to `10` if batchTests is true and value isn't set.

## Caveats

* Pages being tested must be publicly accessible. If authentication is enabled, it is recommended to use searchParams can be used to append a search parameter to the tested page URL that could be used to bypass this.
* Page Caching. Often full pages are cached for a short period of time, and it can introduce significant varance in results depending on whether you hit a cached page or not. To avoid this, this library actually makes a pre-flight request to prime the cache of any page being tested. The downside of this is that this tool will only test front end performance, and real world performance may well be different from this if cache hit rates are low. 
* Note that lighthouse test results can vary. They vary between runs, and the results you get from a single lighthouse test will vary from data provided by Chrome User Experience Reports.
* Basic auth. Unfortunately it is not supported to run tests against sites with basic authentication. 
