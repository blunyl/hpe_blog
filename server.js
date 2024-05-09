require("dotenv").config();

const express = require("express");
const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { MongoClient } = require("mongodb");
const uri = process.env.MONGODB_URL;
const client = new MongoClient(uri);

const fs = require("fs");
const uploadDir = "public/uploads/";

const multer = require("multer");
const path = require("path");

// methodOverride
const methodOverride = require("method-override");
app.use(methodOverride("_method"));

/* jsonwebtoken 
로그인 성공시 토큰 발행 (암호화)
어떤 정보를 넣어서 발행할지 결정할 수 있음, 쿠키에 토큰 저장(로컬스토리지)
토근 정보를 헤더에 반영 , 로그아웃했을때 쿠키삭제 
* cookie-parser 
쿠키사용라이브러리, 쿠키파싱 및 삭제, 쿠키를 데이터에 저장
*/

const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.SECRET_KEY;
const cookieParser = require("cookie-parser");
app.use(cookieParser()); //미들웨어

/*모든 요청에 대해 쿠키 검사, 토큰이 있다면 토큰을 해독해서 req.user 에 userid 저장
토큰이 있으면 로그인 된거 없으면 안된거*/
app.use(async (req, res, next) => {
  // console.log(req.user);
  const token = req.cookies.token;
  //로그인이 된경우 몽고디비가서 암호화된 비번을 해석해서 유저정보를 찾는다
  if (token) {
    try {
      const data = jwt.verify(token, SECRET_KEY);
      const db = await getDB();
      const user = await db
        .collection("users")
        .findOne({ userid: data.userid });
      if (user) req.user = user;
    } catch (e) {
      console.error(e);
    }
  }
  next();
});

//부모 디렉토리가 존재하지 않을 경우, 상위 디렉토리도 함께 생성할 수 있도록 설정
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const getDB = async () => {
  await client.connect();
  return client.db("blog");
};

app.get("/", async (req, res) => {
  const user = req.user ? req.user : null; //user정보
  try {
    const db = await getDB();
    const posts = await db.collection("posts").find().sort({createAtDate: -1}).limit(6).toArray();
    res.render("index", { posts, user: req.user });
  } catch (e) {
    console.error(e);
  }
});

//3개씩 추가되는 포스트 갖고오는 기능
app.get('/getPosts', async(req, res)=>{
  const page = req.query.page || 1
  const postsPerPage = req.query.postsPerPage || 3
  // const postsPerPage =  3
  const skip = 3 + (page - 1) * postsPerPage  //1:0, 2:3

  try{
      const db = await getDB()
      const posts = await db.collection('posts')
          .find()
          .sort({createAtDate:-1})
          .skip(skip)
          .limit(postsPerPage)
          .toArray()
      res.json(posts)
  } catch(e){
      console.error(e)
  }
})


app.get("/write", (req, res) => {
  const user = req.user ? req.user : null;
  res.render("write", { user });
});

// Multer 설정
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

app.post("/write", upload.single("postimg"), async (req, res) => {
  const { title, content } = req.body;
  const postImg = req.file ? req.file.filename : null;
  const createAtDate = new Date();

  try {
    let db = await getDB();
    const result = await db.collection("counter").findOne({ name: "counter" });
    await db.collection("posts").insertOne({
      _id: result.totalPost + 1,
      title,
      content,
      createAtDate,
      userid: req.user.userid,
      username: req.user.username,
      postImgPath: postImg ? `/uploads/${postImg}` : null,
    });
    await db
      .collection("counter")
      .updateOne({ name: "counter" }, { $inc: { totalPost: 1 } });

    // 좋아요 기본 값 셋팅
    await db.collection("like").insertOne({
      post_id: result.totalPost + 1,
      likeTotal: 0,
      likeMember: [],
    });

    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
});

//comment
app.post("/comment/:id", async (req, res) => {
  const post_id = parseInt(req.params.id);
  const { comment } = req.body;
  const createAtDate = new Date();
  console.log("----------", post_id);

  try {
    const db = await getDB();
    await db.collection("comment").insertOne({
      post_id,
      comment,
      createAtDate,
      userid: req.userid,
      username: req.user.username,
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});

//detail page
app.get("/detail/:id", async (req, res) => {
  let id = parseInt(req.params.id);
  try {
    const db = await getDB();
    const posts = await db.collection("posts").findOne({ _id: id });
    const like = await db.collection("like").findOne({ post_id: id });
    const comments = await db
      .collection("comment")
      .find({ post_id: id }).sort({createAtDate:-1})
      .toArray();
    res.render("detail", { posts, user: req.user, like, comments });
  } catch (e) {
    console.error(e);
  }
});

//delete
app.post("/delete/:id", async (req, res) => {
  let id = parseInt(req.params.id);
  try {
    const db = await getDB();
    await db.collection("posts").deleteOne({ _id: id });
    res.redirect("/");
  } catch (e) {
    console.error(e);
  }
});

//수정페이지로 데이터 바인딩
app.get("/edit/:id", async (req, res) => {
  const user = req.user ? req.user : null;
  let id = parseInt(req.params.id);
  try {
    const db = await getDB();
    const posts = await db.collection("posts").findOne({ _id: id });
    // console.log(posts);
    res.render("edit", { posts, user });
  } catch (e) {
    console.error(e);
  }
});

app.post("/edit", upload.single("postimg"), async (req, res) => {
  console.log(req.body);
  const { id, title, content, createAtDate } = req.body;
  const postImgOld = req.body.postImgOld.replace("uploads/", "");
  const postImg = req.file ? req.file.filename : postImgOld;

  try {
    const db = await getDB();
    await db.collection("posts").updateOne(
      { _id: parseInt(id) },
      {
        $set: {
          title,
          content,
          createAtDate,
          postImgPath: postImg ? `/uploads/${postImg}` : null,
        },
      }
    );
    res.redirect("/");
  } catch (e) {
    console.log(e);
  }
});

const bcrypt = require("bcrypt");
const { strictEqual } = require("assert");
const saltRounds = 10;

app.get("/signup", (req, res) => {
  const user = req.user ? req.user : null;
  res.render("signup", { user });
});

app.post("/signup", async (req, res) => {
  const { userid, pw, username } = req.body;
  // console.log(req.body);

  try {
    const hashPw = await bcrypt.hash(pw, saltRounds); //비밀번호 암호화
    const db = await getDB();
    await db.collection("users").insertOne({ userid, username, pw: hashPw });
    res.redirect("/login");
  } catch (e) {
    console.error(e);
  }
});

app.get("/login", (req, res) => {
  const user = req.user ? req.user : null;
  res.render("login", { user });
});

app.post("/login", async (req, res) => {
  const { userid, pw } = req.body;

  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ userid });
    console.log("login data : ", req.body, user);

    if (user) {
      const compareResult = await bcrypt.compare(pw, user.pw);
      if (compareResult) {
        const token = jwt.sign({ userid: user.userid }, SECRET_KEY); //토큰발행
        res.cookie("token", token);
        res.redirect("/");
      } else {
        res.status(401).send();
      }
    } else {
      res.status(404).send();
    }
  } catch (e) {
    console.error(e);
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

//개인페이지 /: 이 부분 작명하는거임
app.get("/personal/:userid", async (req, res) => {
  const postUser = req.params.userid;
  try {
    const db = await getDB();
    const posts = await db
      .collection("posts")
      .find({ userid: postUser })
      .toArray();
    console.log(postUser, posts);
    res.render("personal", { posts, postUser, user: req.user });
  } catch (e) {
    console.error(e);
  }
});

//mypage
app.get("/mypage", (req, res) => {
  res.render("mypage", { user: req.user });
});

//like, like/2 post 요청이 오면 로그인된 userid
app.post("/like/:id", async (req, res) => {
  const postid = parseInt(req.params.id); // 포스트 아이디
  const userid = req.user.userid; // 로그인된 사용자

  try {
    const db = await getDB();
    const like = await db.collection("like").findOne({ post_id: postid });
    if (like.likeMember.includes(userid)) {
      // 이미 좋아요를 누른 경우
      await db.collection("like").updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: -1 },
          $pull: { likeMember: userid },
        }
      );
    } else {
      // 좋아요를 처음 누르는 경우
      await db.collection("like").updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: 1 },
          $push: { likeMember: userid },
        }
      );
    }
    res.redirect("/detail/" + postid);
  } catch (e) {
    console.error(e);
  }
});

app.listen(port, () => {
  console.log(`server loading.. ${port}`);
});
