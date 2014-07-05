var request = require('request');

module.exports = (function build() {

	'use strict';

	return request.defaults({ encoding: 'utf8', headers: { 'User-Agent': 'SKY_skyplus' }, timeout: 5000 });

}());