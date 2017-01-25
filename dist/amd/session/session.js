/*can-connect-feathers@3.1.0#session/session*/
define(function (require, exports, module) {
    var connect = require('can-connect');
    var errors = require('feathers-errors');
    var authAgent = require('feathers-authentication-popups').authAgent;
    var decode = require('jwt-decode');
    var payloadIsValid = require('../utils/utils').payloadIsValid;
    var getStoredToken = require('../utils/utils').getStoredToken;
    var hasValidToken = require('../utils/utils').hasValidToken;
    var convertLocalAuthData = require('../utils/utils').convertLocalAuthData;
    var Observation = require('can-observation');
    var zoneStorage = require('./storage');
    module.exports = connect.behavior('data/feathers-session', function () {
        var helpURL = 'https://canjs.com/doc/can-connect-feathers.html';
        var feathersClient = this.feathersClient;
        if (!feathersClient) {
            throw new Error('You must provide a feathersClient instance to the feathers-session behavior. See ' + helpURL);
        }
        if (!this.Map) {
            throw new Error('You must provide a Map instance to the feathers-session behavior. See ' + helpURL);
        }
        if (!feathersClient.passport) {
            throw new Error('You must register the feathers-authentication-client plugin before using the feathers-session behavior. See ' + helpURL);
        }
        var options = feathersClient.passport.options;
        var Session = this.Map;
        var tokenLocation = options.tokenKey || options.cookie;
        Object.defineProperty(Session, 'current', {
            get: function () {
                Observation.add(Session, 'current');
                if (!zoneStorage.getItem('can-connect-feathers-session')) {
                    Session.get().then(function (session) {
                        zoneStorage.setItem('can-connect-feathers-session', session);
                        Session.dispatch('current', [session]);
                    }).catch(function (error) {
                        if (!error.className || error.className.indexOf('not-authenticated') < 0) {
                            return Promise.reject(error);
                        }
                    });
                }
                var tokenData;
                if (hasValidToken(tokenLocation)) {
                    var token = getStoredToken(tokenLocation);
                    tokenData = decode(token);
                }
                return zoneStorage.getItem('can-connect-feathers-session') || tokenData;
            }
        });
        Session.on('created', function (ev, session) {
            zoneStorage.setItem('can-connect-feathers-session', session);
            Session.dispatch('current', [session]);
        });
        Session.on('destroyed', function () {
            zoneStorage.removeItem('can-connect-feathers-session');
            Session.dispatch('current', [
                undefined,
                zoneStorage.getItem('can-connect-feathers-session')
            ]);
        });
        return {
            init: function () {
                var connection = this;
                authAgent.on('login', function (token) {
                    try {
                        var payload = decode(token);
                        if (!payloadIsValid(payload)) {
                            throw new Error('invalid token');
                        }
                    } catch (error) {
                        throw new Error('An invalid token was received through the feathers-authentication-popups authAgent');
                    }
                    feathersClient.authenticate({
                        strategy: 'jwt',
                        accessToken: token
                    }).then(function (data) {
                        var payload = decode(data.accessToken);
                        connection.createInstance(payload);
                    });
                });
            },
            createData: function (data) {
                var requestData = convertLocalAuthData(data);
                return feathersClient.authenticate(requestData).then(function (response) {
                    return decode(response.accessToken);
                });
            },
            getData: function () {
                return new Promise(function (resolve, reject) {
                    if (hasValidToken(tokenLocation) && !window.doneSsr) {
                        feathersClient.authenticate().then(function (data) {
                            var payload = decode(data.accessToken);
                            return resolve(payload);
                        }).catch(reject);
                    } else {
                        reject(new errors.NotAuthenticated('Not Authenticated'));
                    }
                });
            },
            destroyData: function (session) {
                return feathersClient.logout().then(function () {
                    return session;
                });
            }
        };
    });
});