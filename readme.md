# TS-Levelling

Bot de niveles para Discord desarrollado y adaptado para **TS Community** a partir de [Polaris Open](https://github.com/GDColon/Polaris-Open).

## ✨ Características

* 📈 Sistema de experiencia y niveles basado en la actividad del servidor.
* 🏆 Rangos competitivos inspirados en Brawl Stars mediante roles de Discord.
* 🎨 Tarjetas de `/rank` personalizadas para TS Community.
* 📊 Clasificación del servidor mediante `/top`, con vistas de XP y estadísticas.
* ⭐ Sistema de **Records**: 42 logros con recompensa de XP, incluidos 5 ocultos.
* 🎉 Avisos automáticos de subida de rango, récords y adelantamientos en el top.
* ⚙️ Configuración y gestión del sistema directamente desde Discord.
* 🌐 Leaderboard web con estadísticas y records.
* 🗄️ Persistencia de datos mediante MongoDB.

## 🏆 Rangos

🥉 **Bronce I, II y III**
🥈 **Plata I, II y III**
🥇 **Oro I, II y III**
💎 **Diamante I, II y III**
🔮 **Mítico I, II y III**
🏆 **Legendario I, II y III**
👑 **Maestro I, II y III**
⭐ **Pro**

Cada rango se obtiene al alcanzar el nivel configurado para su rol dentro del servidor.

## 📇 Comando `/rank`

El comando `/rank` muestra el rango, nivel, experiencia, mensajes, posición en la clasificación, records completados y progreso hacia el siguiente rango.

<p align="center">
  <img src="./assets/showcase/rank-legendary.webp" alt="Rango Legendario" width="500">
</p>

Mientras el usuario puede seguir progresando, la tarjeta muestra cuánto le falta para alcanzar el siguiente rango.

Al llegar a **Pro**, el rango máximo, la tarjeta cambia automáticamente para mostrar cuánto le falta para adelantar al siguiente usuario de la clasificación.

<p align="center">
  <img src="./assets/showcase/rank-pro.webp" alt="Rango Pro" width="500">
</p>

## 📊 Comando `/top`

El comando `/top` muestra la clasificación del servidor, con paginación y vistas de XP total, XP del mes, XP del día y estadísticas (mensajes, rachas, reacciones, Poketwo, Counting, voz y más).

<p align="center">
  <img src="./assets/showcase/top-xp.webp" alt="Top de XP" width="500">
</p>

Cada estadística tiene su propio top, como el de Poketwo:

<p align="center">
  <img src="./assets/showcase/top-poketwo.webp" alt="Top de Poketwo" width="500">
</p>

## ⭐ Sistema de Records

Los **Records** son logros del servidor con recompensa de XP. El comando `/records` muestra las estadísticas del usuario y el progreso por categorías.

<p align="center">
  <img src="./assets/showcase/records-stats.webp" alt="Mis Records - Estadísticas" width="500">
</p>

Cada categoría (Actividad, Comunidad, Canales, Voz) tiene sus tiers con progreso y recompensa:

<p align="center">
  <img src="./assets/showcase/records-categoria.webp" alt="Records de Actividad" width="500">
</p>

Hay **5 records ocultos** que no muestran su condición hasta descubrirlos:

<p align="center">
  <img src="./assets/showcase/records-ocultos.webp" alt="Records ocultos" width="500">
</p>

Al completar un record, el bot avisa en el canal de records y por MD si es oculto:

<p align="center">
  <img src="./assets/showcase/records-unlock.webp" alt="Record cumplido" width="500">
</p>

## 🎉 Avisos automáticos

Al subir de rango, el bot felicita al usuario con su nueva tarjeta:

<p align="center">
  <img src="./assets/showcase/levelup.webp" alt="Subida de rango" width="500">
</p>

Y al adelantar a alguien en la clasificación, avisa del adelantamiento:

<p align="center">
  <img src="./assets/showcase/overtake.webp" alt="Adelantamiento" width="500">
</p>

## 🛠️ Tecnologías

* JavaScript
* Node.js
* Discord.js
* MongoDB
* Mongoose

## 📚 Origen

Proyecto basado en [Polaris Open](https://github.com/GDColon/Polaris-Open) por Colon (GDColon), posteriormente adaptado y personalizado para TS Community Brawl.

## 📜 Licencia

Este proyecto tiene licencia dual:

* **Código base (Polaris Open):** ver fichero `LICENSE`. Uso, modificación y distribución libres para fines no comerciales, con crédito a Colon.
* **Modificaciones de TS Community (rangos, tarjetas `/rank`, `/top`, configs, assets, docs, etc.):** todos los derechos reservados, ver fichero `LICENSE-TS`. Se permite ver y estudiar el código, pero no reutilizarlo, desplegarlo ni redistribuirlo sin permiso escrito, salvo el uso autorizado en producción por TS Community.