/*
* IoT Hub Raspberry Pi NodeJS - Microsoft Sample Code - Copyright (c) 2017 - Licensed MIT
*/
'use strict';


const fs = require('fs');
const path = require('path');

const wpi = require('wiringpi-node');

const Client = require('azure-iot-device').Client;
const ConnectionString = require('azure-iot-device').ConnectionString;
const Message = require('azure-iot-device').Message;
const Protocol = require('azure-iot-device-mqtt').Mqtt;


const bi = require('az-iot-bi');

const MessageProcessor = require('./messageProcessor.js');

var ExponentialBackOffWithJitter = require('azure-iot-device').ExponentialBackOffWithJitter;
var TimeoutError = require('azure-iot-device').ErrorFilter;
var NotConnectedError = require('azure-iot-device').ErrorFilter;

var sendingMessage = true;
var messageId = 0;
var client, config, messageProcessor;

function sendMessage() {
  if (!sendingMessage) { return; }
  messageId++;
  messageProcessor.getMessage(messageId, (content, temperatureAlert) => {
    var message = new Message(content);
    message.properties.add('temperatureAlert', temperatureAlert ? 'true' : 'false');
    console.log('Sending message: ' + content);
    client.sendEvent(message, (err) => {
      if (err) {
        console.error('Failed to send message to Azure IoT Hub');
      } else {
        blinkLED();
        console.log('Message sent to Azure IoT Hub');
      }
      setTimeout(sendMessage, config.interval);
    });
  });
}

function onStart(request, response) {
  console.log('Try to invoke method start(' + request.payload || '' + ')');
  sendingMessage = true;

  response.send(200, 'Successully start sending message to cloud', function (err) {
    if (err) {
      console.error('[IoT hub Client] Failed sending a method response:\n' + err.message);
    }
  });
}

function onStop(request, response) {
  console.log('Try to invoke method stop(' + request.payload || '' + ')')
  sendingMessage = false;

  response.send(200, 'Successully stop sending message to cloud', function (err) {
    if (err) {
      console.error('[IoT hub Client] Failed sending a method response:\n' + err.message);
    }
  });
}

function receiveMessageCallback(msg) {
  blinkLED();
  var message = msg.getData().toString('utf-8');
  client.complete(msg, () => {
    console.log('Receive message: ' + message);
  });
}

function blinkLED() {
  // Light up LED for 500 ms
  wpi.digitalWrite(config.LEDPin, 1);
  setTimeout(function () {
    wpi.digitalWrite(config.LEDPin, 0);
  }, 500);
}

function initClient(connectionStringParam, credentialPath) {
  var connectionString = ConnectionString.parse(connectionStringParam);
  var deviceId = connectionString.DeviceId;

  // fromConnectionString must specify a transport constructor, coming from any transport package.
  client = Client.fromConnectionString(connectionStringParam, Protocol);

  // Configure the client to use X509 authentication if required by the connection string.
  if (connectionString.x509) {
    // Read X.509 certificate and private key.
    // These files should be in the current folder and use the following naming convention:
    // [device name]-cert.pem and [device name]-key.pem, example: myraspberrypi-cert.pem
    var connectionOptions = {
      cert: fs.readFileSync(path.join(credentialPath, deviceId + '-cert.pem')).toString(),
      key: fs.readFileSync(path.join(credentialPath, deviceId + '-key.pem')).toString()
    };

    client.setOptions(connectionOptions);

    console.log('[Device] Using X.509 client certificate authentication');
  }

  var myRetryPolicy = {
   shouldRetry: function (err) { 
    // decide depending on err if you would like to retry or not - should return true or false.
	console.log('error occured, need retry, error:', err);
      return true;
   },
   nextRetryTimeout: function (retryCount, throttled) {
    // should return an integer that is the number of milliseconds to wait before the next retry
    // based on the current count of retries (retryCount) 
    // and if the IoT Hub is asking clients to throttle their calls (throttled, boolean)

     return retryCount * 300000;
    }
   } 
   
   //client.setRetryPolicy(new ExponentialBackOffWithJitter(true, [TimeoutError,  NotConnectedError])); 
    client.setRetryPolicy( myRetryPolicy);

  return client;
}

(function (connectionString) {
  // read in configuration in config.jsonps -al

  try {
    config = require('./config.json');
  } catch (err) {
    console.error('Failed to load config.json: ' + err.message);
    return;
  }

  // set up wiring
  wpi.setup('wpi');
  wpi.pinMode(config.LEDPin, wpi.OUTPUT);
  messageProcessor = new MessageProcessor(config);

  try {
    var firstTimeSetting = false;
    if (!fs.existsSync(path.join(process.env.HOME, '.iot-hub-getting-started/biSettings.json'))) {
      firstTimeSetting = true;
    }
    bi.start();
    var deviceInfo = { device: "RaspberryPi", language: "NodeJS" };
    if (bi.isBIEnabled()) {
      bi.trackEventWithoutInternalProperties('yes', deviceInfo);
      bi.trackEvent('success', deviceInfo);
    }
    else {
      bi.disableRecordingClientIP();
      bi.trackEventWithoutInternalProperties('no', deviceInfo);
    }
    if(firstTimeSetting) {
      console.log("Telemetry setting will be remembered. If you would like to reset, please delete following file and run the sample again");
      console.log("~/.iot-hub-getting-started/biSettings.json\n");
    }
    bi.flush();
  } catch (e) {
    //ignore
        console.log('in catch block error::::', e);
  }

  // create a client
  // read out the connectionString from process environment
  connectionString = connectionString || process.env['AzureIoTHubDeviceConnectionString'];
  client = initClient(connectionString, config);

  //if( client == true )
  //{
//	console.log('initclient got NotConnectError, lets re-init client');
//	setTimeout(( function() {
 ////         client = initClient( connectionString, config );
   //     } ) , 300000 );


//  }
  client.open((err) => {
    if (err) {
      console.error('[IoT hub Client] Connect error: ' + err.message);
      return;
    }

    // set C2D and device method callback
    client.onDeviceMethod('start', onStart);
    client.onDeviceMethod('stop', onStop);
    client.on('message', receiveMessageCallback);
// Commenting out Device Twin code for now
/*    setInterval(() => {
      client.getTwin((err, twin) => {
        if (err) {
          console.error("get twin message error");
          return;
        }
        config.interval = twin.properties.desired.interval || config.interval;
      });
    }, config.interval);
*/
    sendMessage();
  });
})(process.argv[2]);
