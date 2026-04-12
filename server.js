import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

console.log("Starting server...");

let players = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  players[socket.id] = { action: null };

  socket.on("gesture", (data) => {
    players[socket.id].action = data;
    io.emit("update", players);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete players[socket.id];
    io.emit("update", players);
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});