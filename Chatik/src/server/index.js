const http = require("http");
const express = require("express");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 8238;

app.use(logger("dev"));
app.use(cookieParser());
app.use(express.static("dist"));

const server = http.createServer(app);
const io = new Server(server);
const activeUsers = {};
const MAX_HISTORY = 1000;
const historyFilePath = path.join(__dirname, "history.json");

function saveMessage(msg){
  fs.readFile(historyFilePath, "utf8", (err, data) => {
    let currentHistory = [];
    
    if (!err && data) {
      try {
          currentHistory = JSON.parse(data);
      } catch (e) {
          currentHistory = [];
      }
    }
    currentHistory.push(msg);
    if (currentHistory.length > MAX_HISTORY) {
      currentHistory.shift();
    }
    fs.writeFile(historyFilePath, JSON.stringify(currentHistory, null, 2), "utf8", (writeErr) => {
      if (writeErr) {
        console.error("Ошибка при перезаписи файла истории:", writeErr);
      }
    });
  });
};

io.on("connection", (socket) => {
    console.log(`Client connected with temporary id: ${socket.id}`);

    socket.on("loginRequest", (nickname) => {
        const cleanNickname = nickname.trim();

        if (!cleanNickname || cleanNickname.length > 25) {
          socket.emit("loginResult", { 
            success: false, 
            message: "Некорректная длина бэт-ника (до 25 бэт-символов)." 
          });
          return;
        }

        const isNicknameTaken = Object.values(activeUsers).some(
          (name) => name.toLowerCase() === cleanNickname.toLowerCase()
        );

        if (isNicknameTaken) {
          const oldSocketId = Object.keys(activeUsers).find(
            (key) => activeUsers[key].toLowerCase() === cleanNickname.toLowerCase()
          );
          if (oldSocketId) {
            delete activeUsers[oldSocketId];
          }
          socket.emit("loginResult", { 
            success: false, 
            message: "Этот бэт-ник уже занят другим бэт-юзером." 
          });
        } else {
            activeUsers[socket.id] = cleanNickname;
            
            socket.emit("loginResult", { success: true });
            console.log(`User registered: ${cleanNickname} (${socket.id})`);
            const joinMsg = `Бэт-компьютер: ${cleanNickname} подсоединился к бэт-связи`;
            saveMessage(joinMsg);
            fs.readFile(historyFilePath, "utf8", (err, data) => {
            let historyToSend = [];
            if (!err && data) {
                try {
                    historyToSend = JSON.parse(data);
                } catch (parseErr) {
                    console.error("Ошибка парсинга JSON истории:", parseErr);
                }
            }
            socket.emit("historyMessages", historyToSend);
            }); 
            io.emit("messageFromServer", `${joinMsg}`);
        }
    });
    socket.on("messageToServer", (msg) => {
      const userNickname = activeUsers[socket.id];
      
      if (!userNickname)
        return;
      const fullMsg = `Бэт-${userNickname}: ${msg}`;

      console.log(`[MSG] ${fullMsg}`);
      saveMessage(fullMsg);
      io.emit("messageFromServer", `${fullMsg}`);
    });
    socket.on("disconnect", () => {
        const userNickname = activeUsers[socket.id];
        if (userNickname) {
          console.log(`Client disconnected: ${userNickname} (${socket.id})`);
          const leaveMsg = `Бэт-компьютер: бэт-${userNickname} покинул бэт-чат`;
          io.emit("messageFromServer", `${leaveMsg}`);
          saveMessage(leaveMsg);
          delete activeUsers[socket.id];
        } else {
            console.log(`Unregistered client disconnected: ${socket.id}`);
        }
    });
});

server.listen(port, () => {
    console.log(`Server started on http://localhost:${port}`);
});