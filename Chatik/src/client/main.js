import { io } from "socket.io-client";

async function main() {
    const socket = io();
    
    let mySocketId = null;
    let isManualLogout = false;

    const loginWindow = document.getElementById("login-window");
    const loginForm = document.getElementById("login-form");
    const nicknameInput = document.getElementById("nickname-input");
    const loginError = document.getElementById("login-error");

    const chatWindow = document.getElementById("chat-window");
    const messagesList = document.getElementById("main");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");
    const logoutBtn = document.getElementById("logout-btn");

    function appendMessageToDOM(msg) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');


        if (msg.senderId === mySocketId) {
            messageDiv.classList.add('outgoing');
        } else {
            messageDiv.classList.add('incoming');
        }
        const textDiv = document.createElement('div');
        textDiv.classList.add('message-text');
        textDiv.textContent = msg.fullmsg || msg.text; 
        
        messageDiv.appendChild(textDiv);
        messagesList.appendChild(messageDiv);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    const savedNickname = localStorage.getItem("chat_nickname");
    if (savedNickname) {
        nicknameInput.value = savedNickname;
        socket.emit("loginRequest", savedNickname);
    }

    loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const nickname = nicknameInput.value.trim();

        if (!nickname) {
            loginError.textContent = "Бэт-ник не может быть пустым";
            loginError.style.display = "block";
            return;
        }
        if (nickname.length > 25) {
            loginError.textContent = "Бэт-ник не должен превышать 25 символов";
            loginError.style.display = "block";
            return;
        }

        loginError.style.display = "none";
        socket.emit("loginRequest", nickname);
    });

    logoutBtn.addEventListener("click", () => {
        isManualLogout = true;
        localStorage.removeItem("chat_nickname");
        messagesList.innerHTML = "";

        chatWindow.style.display = "none";
        loginWindow.style.display = "flex";
        nicknameInput.value = "";
        
        socket.disconnect();
        socket.connect();
    });

    socket.on("loginResult", (response) => {
      if (response.success) {
        const currentNickname = nicknameInput.value.trim();
        localStorage.setItem("chat_nickname", currentNickname);
        mySocketId = socket.id;
        loginWindow.style.display = "none";
        chatWindow.style.display = "flex"; 
      } else {
          localStorage.removeItem("chat_nickname");
          loginError.textContent = response.message;
          loginError.style.display = "block";
      }
    });

    socket.on("historyMessages", (history) => {
        messagesList.innerHTML = ""; 
        if (Array.isArray(history)) {
            history.forEach((msg) => {
                if (typeof msg === 'object') {
                    appendMessageToDOM(msg);
                } else {
                    appendMessageToDOM({ fullmsg: msg, senderId: null });
                }
            });
        }
        setTimeout(() => {
            messagesList.scrollTop = messagesList.scrollHeight;
        }, 50); 
    });

    chatForm.addEventListener("submit", (event) => {
        event.preventDefault(); 
        const text = messageInput.value.trim();
        if (text) {
            socket.emit("messageToServer", text);
            messageInput.value = "";
            messageInput.focus(); 
        }
    });

    socket.on("messageFromServer", function (messageData) {
        appendMessageToDOM(messageData);
    });

    socket.on("disconnect", () => {
        if (!isManualLogout) {
            alert("Бэт-связь потеряна...");
        }
        isManualLogout = false;
    });
}

window.addEventListener("load", () => { main(); });