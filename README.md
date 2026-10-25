# StayEase - Hotel Booking Demo

A small full-stack hotel booking app with two roles (customer and admin).
Node.js + Express + SQLite on the backend, plain HTML/CSS/JS on the frontend.

## Run it (Windows, macOS or Linux)

1. Install Node.js 22.13 or newer (24 LTS is a good choice) from https://nodejs.org. The database uses the SQLite built into Node, so nothing needs compiling.
2. Open a terminal in this folder and run:

       npm install
       npm start

3. Open http://localhost:3000

The database file (`stayease.db`) is created on the first run with sample rooms and posts.
To reset all data, stop the server and delete `stayease.db`.

## Test accounts

| Role     | Email                | Password  |
|----------|----------------------|-----------|
| Admin    | admin@stayease.com   | Admin@123 |
| Customer | register your own on the Register page (password needs 8+ chars, an uppercase letter and a number) |

## What each role can do

- **Customer:** register, log in, read hotel news, search rooms by dates and guests, book a room, view and cancel own bookings (before check-in).
- **Admin:** add, edit and delete rooms (price, capacity, status), publish, edit and delete news posts, see and cancel all bookings.

## Business rules

- Total cost = nights x price per night (no tax, no coupons, no fees).
- A room cannot be booked for overlapping dates, while under maintenance, or for more guests than its capacity.
- A room with upcoming confirmed bookings cannot be deleted.
- Free cancellation any time before the check-in date.

## REST API (JSON)

| Method | Path | Who |
|--------|------|-----|
| POST | /api/auth/register, /api/auth/login | public |
| GET | /api/rooms (optional ?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=2) | public |
| POST, PUT, DELETE | /api/rooms, /api/rooms/:id | admin |
| GET | /api/posts | public |
| POST, PUT, DELETE | /api/posts, /api/posts/:id | admin |
| POST | /api/bookings | customer |
| GET | /api/bookings/mine | customer |
| GET | /api/bookings | admin |
| DELETE | /api/bookings/:id | owner customer or admin |

Send the token from login as `Authorization: Bearer <token>`.

## Testing with KaneAI (TestMu AI)

1. Start the app (`npm start`).
2. Start the TestMu AI tunnel (UnderPass/LT) with your username and access key so the cloud browser can reach localhost:3000.
3. In KaneAI, select the tunnel under Advanced Settings, give it http://localhost:3000, attach the BRD and let it plan the scenarios.
4. Always use future dates for check-in and check-out, and register a fresh customer in each test.

Optional environment variables: `PORT`, `JWT_SECRET`, `DB_FILE`.
