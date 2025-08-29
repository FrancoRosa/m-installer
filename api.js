const Fastify = require("fastify");
const { SerialPort, ReadlineParser } = require("serialport");
const path = require("path");
const cors = require("@fastify/cors");
const { promisify } = require("util");

const fastify = Fastify();
let serialPort = null; // Use a variable to hold the serial port instance
let gpsPort = null; // Use a variable to hold the gps port instance
let lastLocation = { lat: 0, lng: 0 };
// Promisify port.write for easier use with async/await
const writeToPort = promisify((port, data, callback) => {
  port.write(data, callback);
});

function nmeaToDecimal(nmeaCoord, direction) {
  const degrees = Math.floor(nmeaCoord / 100);
  const minutes = nmeaCoord % 100;
  let decimal = degrees + minutes / 60;

  if (direction === "S" || direction === "W") {
    decimal *= -1;
  }

  return decimal;
}

// Function to find the correct serial port
async function findAndConnectSerialPort() {
  console.log("... searching");
  try {
    const ports = await SerialPort.list();
    for (const p of ports) {
      // Filter potential ports (e.g., based on manufacturer or path)
      // This is a good place to add more specific filtering if needed
      if (
        p.path.startsWith("/dev/ttyUSB") ||
        p.path.startsWith("/dev/ttyACM")
      ) {
        console.log(`Trying port: ${p.path}`);
        try {
          const tempPort = new SerialPort({ path: p.path, baudRate: 9600 });
          const parser = tempPort.pipe(
            new ReadlineParser({ delimiter: "\r\n" })
          );

          // Use a promise to handle the 'data' event and timeout
          const response = await Promise.race([
            new Promise((resolve) => {
              const timeout = setTimeout(() => {
                tempPort.close(() => {
                  console.log(`Port ${p.path} timed out. Closing.`);
                  resolve(null);
                });
              }, 2000); // Wait for up to 2 seconds for a response

              const onData = (data) => {
                const responseStr = data.toString().trim();
                console.log(`Received from ${p.path}: ${responseStr}`);
                if (responseStr === "OK") {
                  clearTimeout(timeout);
                  tempPort.off("data", onData);
                  resolve(tempPort); // Found the right port
                }
              };
              tempPort.on("data", onData);

              // Send the "AT" command to test the port
              tempPort.write("AT", (err) => {
                if (err) {
                  console.error(`Error writing to ${p.path}:`, err.message);
                  clearTimeout(timeout);
                  tempPort.close(() => resolve(null));
                }
              });
            }),
            // If the port opens and closes immediately (e.g., not a serial device)
            new Promise((resolve) => {
              tempPort.on("error", (err) => {
                console.error(`Error with port ${p.path}:`, err.message);
                tempPort.close(() => resolve(null));
              });
            }),
          ]);

          if (response) {
            serialPort = response;
            console.log(`Successfully relay: ${serialPort.path}`);
            // Set up the permanent data listener
            const permanentParser = serialPort.pipe(
              new ReadlineParser({ delimiter: "\r\n" })
            );
            permanentParser.on("data", (data) => {
              console.log("Data from relay:", data.toString());
            });

            // Handle disconnection
            serialPort.on("close", () => {
              console.log("... relay disconnected");
              serialPort = null;
              setTimeout(findAndConnectSerialPort, 10000); // Re-trigger search after 5s
            });
            return; // Exit the loop once a port is found
          } else {
            // The tempPort will be closed by the timeout or error handler
            console.log(`Port ${p.path} did not respond with "OK".`);
          }
        } catch (err) {
          console.error(`Could not open port ${p.path}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("Error listing serial ports:", err.message);
  }
  // If we've looped through all ports and haven't found one, wait and try again
  if (!serialPort) {
    console.log("...");
    setTimeout(findAndConnectSerialPort, 5000);
  }
}

async function findAndConnectGPSPort() {
  console.log("... searching");
  try {
    const ports = await SerialPort.list();
    for (const p of ports) {
      // Filter potential ports (e.g., based on manufacturer or path)
      // This is a good place to add more specific filtering if needed
      if (
        p.path.startsWith("/dev/ttyUSB") ||
        p.path.startsWith("/dev/ttyACM")
      ) {
        console.log(`Trying port: ${p.path}`);
        try {
          const tempPort = new SerialPort({ path: p.path, baudRate: 9600 });
          const parser = tempPort.pipe(
            new ReadlineParser({ delimiter: "\r\n" })
          );

          // Use a promise to handle the 'data' event and timeout
          const response = await Promise.race([
            new Promise((resolve) => {
              const timeout = setTimeout(() => {
                tempPort.close(() => {
                  console.log(`Port ${p.path} timed out. Closing.`);
                  resolve(null);
                });
              }, 2700); // Wait for up to 2 seconds for a response

              const onData = (data) => {
                const responseStr = data.toString().trim();
                console.log(`Received from ${p.path}: ${responseStr}`);
                if (responseStr.includes("GPGGA")) {
                  clearTimeout(timeout);
                  tempPort.off("data", onData);
                  resolve(tempPort); // Found the right port
                }
              };
              tempPort.on("data", onData);

              // Send the "AT" command to test the port
            }),
            // If the port opens and closes immediately (e.g., not a serial device)
            new Promise((resolve) => {
              tempPort.on("error", (err) => {
                console.error(`Error with port ${p.path}:`, err.message);
                tempPort.close(() => resolve(null));
              });
            }),
          ]);

          if (response) {
            gpsPort = response;
            console.log(`Successfully connected gps: ${gpsPort.path}`);
            // Set up the permanent data listener
            const permanentParser = gpsPort.pipe(
              new ReadlineParser({ delimiter: "\r\n" })
            );
            permanentParser.on("data", (data) => {
              const gpsPayload = data.toString();
              if (gpsPayload.includes("$GPRMC")) {
                const target = gpsPayload;
                const parts = target.split(",");
                // GPRMC format: $GPRMC,time,status,lat,N/S,lon,E/W,...
                if (parts[2] === "A") {
                  // 'A' means data is valid
                  const lat = nmeaToDecimal(parseFloat(parts[3]), parts[4]);
                  const lng = nmeaToDecimal(parseFloat(parts[5]), parts[6]);
                  lastLocation = { lat, lng };
                }
              }
            });

            // Handle disconnection
            gpsPort.on("close", () => {
              console.log("... gps disconnected");
              gpsPort = null;
              setTimeout(findAndConnectGPSPort, 13000); // Re-trigger search after 5s
            });
            return; // Exit the loop once a port is found
          } else {
            // The tempPort will be closed by the timeout or error handler
            console.log(`GPS ${p.path} did not respond with "$NMEA".`);
          }
        } catch (err) {
          console.error(`Could not open port ${p.path}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("Error listing serial ports:", err.message);
  }
  // If we've looped through all ports and haven't found one, wait and try again
  if (!gpsPort) {
    console.log("...");
    setTimeout(findAndConnectGPSPort, 5000);
  }
}

// Initial port search
findAndConnectSerialPort();
findAndConnectGPSPort();

// CORS setup
fastify.register(cors, {
  origin: "*",
});

// Static file serving
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname),
  prefix: "/",
});

fastify.get("/", async (request, reply) => {
  return reply.sendFile("index.html");
});

fastify.post("/", async (request, reply) => {
  if (!serialPort || !serialPort.isOpen) {
    return reply
      .code(503)
      .send({ error: "Serial port not connected or not ready. Please wait." });
  }

  const { command } = request.body;

  if (command === "on" || command === "off") {
    const msg = `AT+CH1=${command === "on" ? 1 : 0}`; // Add \r\n for line ending
    try {
      await writeToPort(serialPort, msg);
      console.log(msg.trim());

      // The original logic with the setTimeout is moved here
      setTimeout(async () => {
        const offMsg = "AT+CH1=0";
        try {
          await writeToPort(serialPort, offMsg);
          console.log(`Sent auto-off command: ${offMsg.trim()}`);
        } catch (err) {
          console.error("Error sending auto-off command:", err.message);
        }
      }, 10000);

      return { status: "sent", message: msg.trim() };
    } catch (err) {
      console.error("Error writing to serial port:", err.message);
      return reply.code(500).send({ error: "Serial write failed" });
    }
  } else {
    return reply.code(400).send({ error: "Invalid command" });
  }
});

fastify.get("/location", async (request, reply) => {
  if (!gpsPort || !gpsPort.isOpen) {
    return reply
      .code(503)
      .send({ error: "GPS not connected or not ready. Please wait." });
  }

  return lastLocation;
});

fastify.get("/demolocation", async (request, reply) => {
  return { lat: -13.0, lng: -72.0 };
});
// Start server
fastify.listen({ port: 10000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
