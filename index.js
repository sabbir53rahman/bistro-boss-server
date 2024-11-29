const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json());

// Verify JWT middleware
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: "Unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: true, message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.at16f.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return ObjectId.isValid(id) && new ObjectId(id).toString() === id;
};

async function run() {
  try {
    await client.connect();
    const db = client.db("bistroDB");
    const menuCollection = db.collection("menu");
    const cartCollection = db.collection("cart");
    const usersCollection = db.collection("users");
    const paymentCollection = db.collection("payments");

    // JWT token generation
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Fetch users
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Admin verification
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.status(403).send({ admin: false });
      }
      const user = await usersCollection.findOne({ email });
      const isAdmin = user?.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ error: true, message: "Invalid ID" });
      }
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role: "admin" } };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Menu endpoints
    app.get("/menu", async (req, res) => {
      const menuItems = await menuCollection.find().toArray();
      res.send(menuItems);
    });

    app.post("/menu", verifyJWT, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ error: true, message: "Invalid ID" });
      }
      const result = await menuCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Cart endpoints
    app.post("/cart", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ error: true, message: "Invalid ID" });
      }
      const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/cart/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const items = await cartCollection.find({ email }).toArray();
      res.send(items);
    });

    // Stripe payment endpoint
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { amount } = req.body;

      // Ensure the amount is provided and in the smallest currency unit (e.g., cents for USD)
      if (!amount || amount < 50) {
        return res.status(400).send({
          error: true,
          message:
            "Amount must be at least the minimum chargeable amount (e.g., 50 cents for USD).",
        });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount, // Amount in the smallest currency unit
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({
          error: true,
          message: "An error occurred while processing the payment.",
        });
      }
    });

    app.post('/payments', async(req, res) =>{
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      // carefully delete each item from the cart
      console.log('payment info', payment);
      const query = {_id:{
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}
      const deleteResult = await cartCollection.deleteMany(query);

      res.send({paymentResult, deleteResult})
    })

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } finally {
    // Do not close the client to allow reuse across multiple requests
  }
}

run().catch(console.dir);
