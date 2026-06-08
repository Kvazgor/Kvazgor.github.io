import { io } from "socket.io-client";

async function main() {
    const socket = io();

    const loginWindow = document.getElementById("login-window");
    const loginForm = document.getElementById("login-form");
    const nicknameInput = document.getElementById("nickname-input");
    const loginError = document.getElementById("login-error");

    const chatWindow = document.getElementById("chat-window");
    const messagesList = document.getElementById("main");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");

    const savedNickname = localStorage.getItem("chat_nickname");
    if (savedNickname) {
        socket.emit("loginRequest", savedNickname);
    }

    loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const nickname = nicknameInput.value.trim();

        if (nickname.length > 25) {
            loginError.textContent = "Бэт-ник не должен превышать 25 символов";
            loginError.style.display = "block";
            return;
        }
        socket.emit("loginRequest", nickname);
    });

    socket.on("loginResult", (response) => {
      if (response.success) {
        const currentNickname = nicknameInput.value.trim() || localStorage.getItem("chat_nickname");
        localStorage.setItem("chat_nickname", currentNickname);
        loginWindow.style.display = "none";
        chatWindow.style.display = "block";
      } else {
          localStorage.removeItem("chat_nickname");
          loginError.textContent = response.message;
          loginError.style.display = "block";
      }
    });

    socket.on("historyMessages", (history) => {
      messagesList.innerHTML = ""; 
      history.forEach((msg) => {
        const item = document.createElement('ul');
        item.textContent = msg;
        messagesList.appendChild(item);
      });
      window.scrollTo(0, document.body.scrollHeight);
    });

    chatForm.addEventListener("submit", (event) => {
        event.preventDefault(); 
        const text = messageInput.value.trim();
        if (text) {
            socket.emit("messageToServer", text);
            messageInput.value = "";
        }
    });
    socket.on("messageFromServer", function (msg) {
        const item = document.createElement('ul');
        item.textContent = msg;
        messagesList.appendChild(item);
        window.scrollTo(0, document.body.scrollHeight); 
        });
    socket.on("disconnect", () => {
        console.log("Disconnected from server");
    });
}

window.addEventListener("load", () => {
    main();
});