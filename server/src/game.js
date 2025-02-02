const NetworkAction = require("./shared/NetworkActions.js");
const present = require("present");

const { createPlayer } = require("./objects/Player.js");

let singleBananas = [];
let bunchBananas = [];

const WORLD_WIDTH = 4800;
const WORLD_HEIGHT = 2600;

const BANANA_EAT_TOL = 75;
//const BANANA_MAGNET_TOL = 75;
const BANANA_MAGNET_TOL = 150;

let timer = 0;

const segmentDistance = 30;
const rotateRate = Math.PI / 1000; // Radians per second
const moveRate = 200 / 1000; // Pixels per second
const UPDATE_RATE_MS = 30;
let inputQueue = [];
let updateQueue = [];

const activeClients = {};
let quit = false;

function initializeSocketIO(server) {
    const io = require("socket.io")(server);

    function notifyConnect(socket, newPlayer) {
        for (let clientId in activeClients) {
            let client = activeClients[clientId];
            if (newPlayer.clientId !== clientId) {
                client.socket.emit("connect_other", {
                    snake: newPlayer.snake,
                    playerId: socket.id,
                });

                socket.emit("connect_other", {
                    playerId: client.socket.id,
                    snake: client.player.snake,
                });
            }
        }
    }

    function notifyDisconnect(playerId) {
        for (const clientId in activeClients) {
            let client = activeClients[clientId];
            if (playerId !== clientId) {
                client.socket.emit(NetworkAction.DISCONNECT_OTHER);
            }
        }
    }

    io.on("connection", function (socket) {
        console.log("Connection established: ", socket.id);

        socket.emit("connect-ack", {});

        socket.on("join-request", function (data) {
            const newPlayer = createPlayer(
                socket.id,
                moveRate,
                rotateRate,
                segmentDistance,
                data.name,
            );
            activeClients[socket.id] = {
                socket: socket,
                player: newPlayer,
            };

            socket.emit("join", {
                position: {
                    x: newPlayer.snake.head.center.x,
                    y: newPlayer.snake.head.center.y,
                },
                rotation: newPlayer.snake.direction,
                moveRate,
                rotateRate,
                segmentDistance,
                startingSegments: 3,
                single_bananas: singleBananas,
                alive: true,
            });

            notifyConnect(socket, newPlayer);
        });

        socket.on("disconnect", function () {
            delete activeClients[socket.id];
            console.log("Player " + socket.id + " disconnected");
            inputQueue = [
                ...inputQueue.filter((input) => input.clientId !== socket.id),
            ];
            notifyDisconnect(socket.id);
        });

        socket.on("input", (data) => {
            inputQueue.push({
                clientId: socket.id,
                message: data,
            });
        });
    });
}

function processInput(elapsedTime) {
    const processNow = [...inputQueue];
    inputQueue = [];

    while (processNow.length) {
        const input = processNow.shift();
        if (!input) continue;
        const client = activeClients[input.clientId];
        if (!client) continue;
        switch (input.message.command) {
            case "down":
                client.player.snake.setDirectionDown();
                break;
            case "up":
                client.player.snake.setDirectionUp();
                break;
            case "right":
                client.player.snake.setDirectionRight();
                break;
            case "left":
                client.player.snake.setDirectionLeft();
                break;
            case "up-left":
                client.player.snake.setDirectionUpLeft();
                break;
            case "down-left":
                client.player.snake.setDirectionDownLeft();
                break;
            case "up-right":
                client.player.snake.setDirectionUpRight();
                break;
            case "down-right":
                client.player.snake.setDirectionDownRight();
                break;
        }
        updateQueue.push({
            type: "input",
            player_id: client.socket.id,
            desired: client.player.snake.head.desiredRotation,
            turnPoint: { ...client.player.snake.head.center },
        });
    }
}

let food_id = 0;

function spawnNewBanana() {
    if (singleBananas.length >= 1000) return;
    let bananaSpawnX = Math.random() * WORLD_WIDTH;
    let bananaSpawnY = Math.random() * WORLD_HEIGHT;
    let bananaColor = Math.floor(Math.random() * 6);
    food_id++;

    const banana = {
        bananaX: bananaSpawnX,
        bananaY: bananaSpawnY,
        bananaColor,
        id: food_id,
    };

    singleBananas.push(banana);

    updateQueue.push({
        type: "new_single",
        bananaSpawnX,
        bananaSpawnY,
        bananaColor,
        id: food_id,
    });
}

function testSnakeWallCollision(snake, clientId) {
    if (snake.isAlive()) {
        let hitHorizontalWall =
            snake.head.center.x < 0 || snake.head.center.x > WORLD_WIDTH;
        let hitVerticalWall =
            snake.head.center.y < 0 || snake.head.center.y > WORLD_HEIGHT;
        if (hitHorizontalWall || hitVerticalWall) {
            snake.kill();
            createDeathBananas(snake);
            updateQueue.push({
                type: "snake_kill",
                snake_id: clientId,
            });
        }
    }
}

function testSnakeCollision(snake, elapsedTime, clientId) {
    // take care of this after snake death is moved to server
}

function testBananaCollision(snake, elapsedTime, clientId) {
    let newSingleBananas = [];
    let newBunchBananas = [];

    for (let banana of singleBananas) {
        // pull in banana
        if (
            Math.abs(snake.head.center.x - banana.bananaX) <
                BANANA_MAGNET_TOL &&
            Math.abs(snake.head.center.y - banana.bananaY) < BANANA_MAGNET_TOL
        ) {
            magnetPull(
                snake.head.center.x,
                snake.head.center.y,
                banana,
                elapsedTime,
            );
        }

        if (
            Math.abs(snake.head.center.x - banana.bananaX) > BANANA_EAT_TOL ||
            Math.abs(snake.head.center.y - banana.bananaY) > BANANA_EAT_TOL
        ) {
            newSingleBananas.push(banana);
            // eat banana
        } else {
            updateQueue.push({
                type: "eat_single",
                banana_id: banana.id,
                snake_id: clientId,
            });
        }
    }
    singleBananas = newSingleBananas;

    /*
  for (let bunch of bunchBananas) {
    if (
      Math.abs(snake.head.center.x - bunch.center.x) <
        BANANA_MAGNET_TOL &&
        Math.abs(snake.head.center.y - bunch.center.y) <
          BANANA_MAGNET_TOL
    ) {
      magnetPull(snake.head.center.x, snake.head.center.y, bunch, elapsedTime);
    }

    if (
      Math.abs(snake.head.center.x - bunch.center.x) >
        BANANA_EAT_TOL ||
        Math.abs(snake.head.center.y - bunch.center.y) > BANANA_EAT_TOL
    ) {
      newBunchBananas.push(bunch);
    } else {
      snake.eatBananaBunch();
      particle_system.eatBanana(bunch);
    }
  }
  bunchBananas = newBunchBananas;
    */
}

function createDeathBananas(snake) {
    let bananaColor = Math.floor(Math.random() * 6);

    for (let segment of snake.body) {
        let bananaSpawnX = segment.center.x;
        let bananaSpawnY = segment.center.y;
        food_id++;

        const bunch = {
            bananaX: bananaSpawnX,
            bananaY: bananaSpawnY,
            bananaColor,
            id: food_id,
        };

        bunchBananas.push(bunch);
        //console.log("ADDING BUNCH");

        updateQueue.push({
            type: "new_bunch",
            bananaSpawnX,
            bananaSpawnY,
            bananaColor,
            id: food_id,
        });
    }
}

function magnetPull(x, y, banana) {
    updateQueue.push({
        type: "magnet_pull",
        pullLoc: { x, y },
        bananaX: banana.bananaX,
        bananaY: banana.bananaY,
        banana_id: banana.id,
    });
}

function updateTime(elapsedTime) {
    timer += elapsedTime;
    if (timer >= 100) {
        timer -= 100;
        spawnNewBanana();
    }
}

function update(elapsedTime, currentTime) {
    updateTime(elapsedTime);
    for (const [id, activeClient] of Object.entries(activeClients)) {
        activeClient.player.snake.update(elapsedTime);
        testSnakeWallCollision(activeClient.player.snake, id);
        testSnakeCollision(activeClient.player.snake, elapsedTime, id);
        testBananaCollision(activeClient.player.snake, elapsedTime, id);
    }
}

function updateClients(elapsedTime) {
    const tmpUpdateQueue = [...updateQueue];
    updateQueue = [];
    for (const event of tmpUpdateQueue) {
        for (const clientId in activeClients) {
            let client = activeClients[clientId];
            if (clientId == event.player_id) continue;
            if (event.type === "input") {
                client.socket.emit("update_other", event);
            }
            if (event.type === "new_single") {
                client.socket.emit("new_single", event);
            }
            if (event.type === "new_bunch") {
                client.socket.emit("new_bunch", event);
            }
            if (event.type === "magnet_pull") {
                client.socket.emit("magnet_pull", event);
            }
            if (event.type === "eat_single") {
                client.socket.emit("eat_single", event);
            }
            if (event.type === "snake_kill") {
                client.socket.emit("snake_kill", event);
            }
        }
    }
}

function gameLoop(currentTime, elapsedTime) {
    processInput(elapsedTime);
    update(elapsedTime, currentTime);
    updateClients(elapsedTime);

    let tmp_now = present();
    if (!quit) {
        setTimeout(
            () => {
                let now = present();
                gameLoop(now, now - currentTime);
            },
            UPDATE_RATE_MS - (tmp_now - currentTime),
        );
    }
}

function terminate() {
    quit = true;
}

function start(server) {
    initializeSocketIO(server);
    gameLoop(present(), 0);
}

exports.start = start;
