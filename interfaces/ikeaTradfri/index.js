/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
 
/*
 * IKEA Tradfri Interface
 *
 * This hardware interface can communicate with IKEA Tradfri devices.
 * 
 */
 
const fetch = require('node-fetch');
const http = require('http');

const LightController = require('./LightController.js');
const SensorController = require('./SensorController.js');
const server = require('../../../../libraries/hardwareInterfaces');
const { Console } = require('winston/lib/winston/transports');
 
let settings = server.loadHardwareInterface(__dirname);
 
exports.enabled = settings('enabled');
exports.configurable = true; // can be turned on/off/adjusted from the web frontend
exports.settings = {};

function sleep(ms) {
    return new Promise((res) => {
        setTimeout(res, ms);
    });
}

/**
 * Attempt to automatically retrieve the local bridge IP
 */
async function getLocalBridgeIP() {
    
    var discoverGateway = tradfriLib.discoverGateway;
    const result = await discoverGateway();
    
    if (!!result === false) { 
        console.log('IKEA Tradfri: no gateway found!');
        exports.settings.status.connection = 'NO IKEA TRADFRI GATEWAY FOUND';
        return null;
    }
 
    console.log("IKEA Tradfri: " + result.addresses[0]);
    
    return result.addresses[0];
}

if (exports.enabled) {
    server.enableDeveloperUI(true);
 
    /**
     * runs once, adds and clears the IO points
     */
    async function setup() {
        console.log('IKEA Tradfri: Setup...');
        
        // Reload settings
        settings = server.loadHardwareInterface(__dirname);
 
        exports.settings = {
            status: {
                type: 'status',
                connection: 'DISCOVERING IKEA TRADFRI GATEWAY',
            },
            localBridgeIP: {
                value: settings('localBridgeIP'),
                type: 'text',
                default: '',
                helpText: 'The IP address of the IKEA Tradfri Gateway.',
            },
            securityCode: {
                value: settings('securityCode'),
                type: 'text',
                default: '',
                helpText: 'The security code is located on the underside of the IKEA Tradfri Gateway.',
            },
            identity: {
                value: settings('identity'),
                type: 'text',
                default: '',
                helpText: 'Identity is set automaticaly when the correct IP and security code are set.',
            },
            psk: {
                value: settings('psk'),
                type: 'text',
                default: '',
                helpText: 'PSK is set automaticaly when the correct IP and security code are set.',
            }
            
        };
 
        let localBridgeIP = '';
        let securityCode = '';
        let identity = '';
        let psk = '';
        let settingsNeedUpdate = false;
        
        if (settings('localBridgeIP')) {
            localBridgeIP = settings('localBridgeIP');
        } else {
            const bridgeIP = await getLocalBridgeIP();
            
            if (bridgeIP == null)
                return;

            localBridgeIP = bridgeIP;

            exports.settings.localBridgeIP.value = localBridgeIP;
            settingsNeedUpdate = true;
        }
 
        tradfri = await new TradfriClient(localBridgeIP);
        console.log('IKEA Tradfri: Connected to tradfri:', tradfri.hostname);
        exports.settings.status.connection = 'IKEA TRADFRI GATEWAY FOUND';

        if (settings('identity') && settings('psk')) {
            console.log('IKEA Tradfri: Identity and psk known.');
            identity = settings('identity');
            psk = settings('psk');
        } else {
            if (!settings('securityCode')) {
                console.log('IKEA Tradfri: No security code set, unable to authenticate.');
                exports.settings.status.connection = 'ADD IKEA TRADFRI GATEWAY SECURITY CODE';
            }
            else
            {
                securityCode = settings('securityCode');
                console.log('IKEA Tradfri: Unknown identity and PSK, using securityCode');
                
                try {
                    const authResponse = await tradfri.authenticate(securityCode);
                    console.log(authResponse);
                    identity = authResponse.identity;
                    psk = authResponse.psk;
                    
                    exports.settings.status.connection = 'PAIRED WITH IKEA TRADFRI GATEWAY';
                    exports.settings.identity.value = identity;
                    exports.settings.psk.value = psk;
                                    
                    settingsNeedUpdate = true;
                }
                catch {
                    exports.settings.status.connection = 'INVALID IKEA TRADFRI GATEWAY SECURITY CODE';
                }
            }
        }
 
        if (settingsNeedUpdate) {
            server.setHardwareInterfaceSettings('ikeaTradfri', exports.settings, null, function(successful, error) {
                if (error) {
                    console.log('error persisting settings', error);
                }
            });
        }
    }
 
    /**
     * The main function
     */
    async function ikeaTradfriServer() { // eslint-disable-line no-inner-declarations
        console.log('IKEA Tradfri: Starting hardware infterface...');
        
        await setup();
 
        try {
            await tradfri.connect(exports.settings.identity.value, exports.settings.psk.value);
        } catch (e) {
            console.log("IKEA Tradfri: Connection failed!");

            exports.settings.status.connection = 'INVALID IKEA TRADFRI GATEWAY IDENTITY / PSK';
            exports.settings.identity.value = "";
            exports.settings.psk.value = "";

            server.setHardwareInterfaceSettings('ikeaTradfri', exports.settings, null, function(successful, error) {
                if (error) {
                    console.log('error persisting settings', error);
                }
            });

            return;
        }

        const lightControllerInstance = new LightController(tradfri, server); 
        const sensorControllerInstance = new SensorController(tradfri, server); 

        tradfri
            .on("device updated", tradfri_deviceUpdated)
            .on("device removed", tradfri_deviceRemoved)
            .observeDevices()
        ;
 
        let devices = {};
        const remotes = {};

        function tradfri_deviceUpdated(device) {
            console.log('Found device', device.name, device.instanceId);

            let isNewDevice = false;
            if (devices[device.instanceId] == undefined) {
                isNewDevice = true;
                devices[device.instanceId] = true;
            }
			switch (device.type)
			{
				case AccessoryTypes.lightbulb:
                    if(isNewDevice) 
                        lightControllerInstance.onAddDevice(device);
                    else
                        lightControllerInstance.onUpdateDevice(device);
					break;
				
				case AccessoryTypes.remote:
                case AccessoryTypes.motionSensor:
					if(isNewDevice)
                        sensorControllerInstance.onAddDevice(device);
                    else
                        sensorControllerInstance.onUpdateDevice(device);
			}            
        }
 
        function tradfri_deviceRemoved(instanceId) {
            delete devices[instanceId];
            
            //TODO: remove device
        }
    }
    
    var tradfriLib = require('node-tradfri-client');
    var TradfriClient = tradfriLib.TradfriClient;
    var AccessoryTypes = tradfriLib.AccessoryTypes;
    var tradfri;
    const delay = require( 'delay' );

    ikeaTradfriServer();
}