# Nomad-Hub

A server for Nomad-Hub client

## Run Locally

Clone the project

```bash
  git clone https://github.com/A1-mamun/Nomad-Hub-Server.git
```

Go to the project directory

```bash
  cd Nomad-Hub-Server
```

Install dependencies

```bash
  npm install
```

Create a `.env` file in your root directory and add the following to connect with mongoDB

```bash
DB_USER=   // add your db user id
DB_PASS=  // add your db user password
ACCESS_TOKEN_SECRET= // add jwt access token secret
STRIPE_SECRET_KEY= // add stripe secret key
TRANSPORTER_EMAIL= // add a transporter email
TRANSPORTER_PASSWORD= // add the transporter email
```

Start the server

```bash
  npm run dev
```
