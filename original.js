require("dotenv").config();

const express = require("express");
const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));

//이걸 해줘야 req.body 했을때 제대로 받아올수있다 (write)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//mongo db
const { MongoClient } = require("mongodb");
const url = process.env.MONGODB_URL;
const client = new MongoClient(url);

const getDB = async () => {
  await client.connect();
  return client.db("blog");
};

//multer
const fs = require("fs");
const uploadDir = "public/uploads/";

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // 파일이 저장될 경로를 지정
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    ); // 파일 이름 설정
  },
});

const upload = multer({ storage: storage });

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/write", (req, res) => {
  res.render("write");
});

app.post("/write", upload.single("postimg"), async (req, res) => {
  console.log(req.body);
  const { title, content, createAtDate } = req.body;
  const postImg = req.file ? req.file.filename : null;

  try {
    let db = await getDB();
    const result = await db.collection("counter").findOne({ name: "counter" });
    await db.collection("posts").insertOne({
      _id: result.totalPost + 1,
      title,
      content,
      createAtDate,
      postImgPath: postImg ? `uploads/${postImg}` : null,
    });
    await db
      .collection("counter")
      .updateOne({ name: "counter" }, { $inc: { totalPost: 1 } });
    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
});

app.listen(port, () => {
  console.log("server!!", `${port}`);
});
