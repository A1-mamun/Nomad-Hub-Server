// Load environment variables
require("dotenv").config();

// import dependencies
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//  initialize express app
const app = express();
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access!" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access!" });
    }
    req.user = decoded;
    next();
  });
};

// connect to the database
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xrf0qev.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Collections
    const db = client.db("NomadHub");
    const roomsCollection = db.collection("rooms");
    const usersCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");
    // vefify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result.role !== "Admin") {
        return res.status(401).send({ message: "unauthorized access!" });
      }
      next();
    };

    // vefify host middleware
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result.role !== "Host") {
        return res.status(401).send({ message: "unauthorized access!" });
      }
      next();
    };

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // Get all rooms from the database
    app.get("/rooms", async (req, res) => {
      const category = req.query.category;
      let query = {};
      if (category && category !== "null") query = { category };
      const rooms = await roomsCollection.find(query).toArray();
      res.send(rooms);
    });

    // Get a room by id
    app.get("/room/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const room = await roomsCollection.findOne(query);
      res.send(room);
    });

    // Create a new room
    app.post("/add-room", verifyToken, verifyHost, async (req, res) => {
      const room = req.body;
      const result = await roomsCollection.insertOne(room);
      res.send(result);
    });

    // save a user
    app.put("/user", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check if user already exists
      const isUserExists = await usersCollection.findOne(query);
      if (isUserExists) {
        if (user.status === "Requested") {
          // if existing user is requesting to become a host
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isUserExists);
        }
      }
      // save user first time
      const options = { upsert: true };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // get a user by email
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // get all users from the database
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find({}).toArray();
      res.send(users);
    });

    // update user role
    app.patch("/user/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // delete a room
    app.delete(
      "/delete-room/:id",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await roomsCollection.deleteOne(query);
        res.send(result);
      }
    );
    // get all rooms by a user(host)
    app.get(
      "/my-listings/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email;
        console.log(email);
        let query = { "host.email": email };
        const rooms = await roomsCollection.find(query).toArray();
        res.send(rooms);
      }
    );

    // create payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const amount = req.body.price;
      const amountInCents = parseFloat(amount) * 100;
      if (!amount || amountInCents <= 0) {
        return res.status(400).send({ message: "Invalid amount" });
      }
      // generate client secret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: "usd",
      });
      // send the client secret to the client as response
      res.send({ clientSecret: client_secret });
    });

    // save a booking details
    app.post("/booking", verifyToken, async (req, res) => {
      const bookingInfo = req.body;
      // save booking info
      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    });

    // update room status
    app.patch("/room/status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { booked: status },
      };
      const result = await roomsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // get all bookings for guest
    app.get("/my-bookings/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "guest.email": email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });
    // Cancel a booking by guest
    app.delete("/booking/cancel/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // get all hosted rooms for host
    app.get(
      "/hosted-rooms/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email;
        const query = { "host.email": email };
        const result = await roomsCollection.find(query).toArray();
        res.send(result);
      }
    );

    // admin stats
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingsCollection
        .find(
          {},
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray();
      const totalUsers = await usersCollection.countDocuments();
      const totalRooms = await roomsCollection.countDocuments();
      const totalSales = bookingDetails.reduce(
        (acc, cur) => acc + parseFloat(cur.price),
        0
      );
      const chartData = bookingDetails.map((booking) => {
        const day = new Date(booking.date).getDate();
        const month = new Date(booking.date).getMonth() + 1;
        const data = [`${day}/${month}`, booking?.price];
        return data;
      });
      chartData.unshift(["Day", "Price"]);
      res.send({
        totalBookings: bookingDetails.length,
        totalUsers,
        totalRooms,
        totalSales,
        chartData,
      });
    });

    // host stats
    app.get("/host-stats", verifyToken, verifyHost, async (req, res) => {
      const email = req.user.email;
      const bookingDetails = await bookingsCollection
        .find(
          { "host.email": email },
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray();

      const { timestamp } = await usersCollection.findOne(
        { email },
        { projection: { timestamp: 1 } }
      );

      const totalRooms = await roomsCollection.countDocuments({
        "host.email": email,
      });
      const totalSales = bookingDetails.reduce(
        (acc, cur) => acc + parseFloat(cur.price),
        0
      );
      const chartData = bookingDetails.map((booking) => {
        const day = new Date(booking.date).getDate();
        const month = new Date(booking.date).getMonth() + 1;
        const data = [`${day}/${month}`, booking?.price];
        return data;
      });
      chartData.unshift(["Day", "Price"]);
      res.send({
        totalBookings: bookingDetails.length,
        totalRooms,
        totalSales,
        chartData,
        hostSince: timestamp,
      });
    });
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

// define routes after successfully connecting to the database
app.get("/", (req, res) => {
  res.send("Nomad Hub Published");
});
// start the server
app.listen(port, () => {
  console.log(`Server is running at PORT: ${port}`);
});
