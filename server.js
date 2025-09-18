const express = require('express');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;

const mabiAuctionRouter = require('./routes/mabiAuction');
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/api/mabi-auction', mabiAuctionRouter);

if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const db = new sqlite3.Database(path.join(__dirname, 'data', 'board.db'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// 데이터베이스 초기화
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        createdAt TEXT,
        lastLoginAt TEXT,
        loginCount INTEGER DEFAULT 0
    )`);

    ['createdAt TEXT', 'lastLoginAt TEXT', 'loginCount INTEGER DEFAULT 0'].forEach(col => {
        db.run(`ALTER TABLE users ADD COLUMN ${col}`, () => {});
    });

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        boardType TEXT DEFAULT 'deal',
        title TEXT,
        content TEXT,
        image TEXT,
        createdAt TEXT,
        auctionInfo TEXT,
        FOREIGN KEY(userId) REFERENCES users(id)
    )`);

    ['boardType TEXT DEFAULT \'deal\'', 'auctionInfo TEXT'].forEach(col => {
        db.run(`ALTER TABLE posts ADD COLUMN ${col}`, () => {});
    });

    db.run(`UPDATE posts SET boardType = 'deal' WHERE boardType IS NULL`);

    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postId INTEGER,
        userId INTEGER,
        username TEXT,
        content TEXT,
        parent_id INTEGER,
        depth INTEGER DEFAULT 0,
        createdAt TEXT,
        FOREIGN KEY(postId) REFERENCES posts(id),
        FOREIGN KEY(parent_id) REFERENCES comments(id)
    )`);

    ['parent_id INTEGER', 'depth INTEGER DEFAULT 0', 'username TEXT'].forEach(col => {
        db.run(`ALTER TABLE comments ADD COLUMN ${col}`, () => {});
    });
});

// 미들웨어 설정
app.set('view engine', 'ejs');
app.set('layout', 'layout');
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(expressLayouts);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// 유틸리티 함수
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

const getBoardTitle = (boardType) => {
    const titles = {
        'free': '자유게시판',
        'notice': '공지사항',
        'deal': '거래 게시판'
    };
    return titles[boardType] || titles.free;
};

const getHierarchicalComments = (postId, callback) => {
    db.all(`SELECT * FROM comments WHERE postId = ? ORDER BY 
            CASE WHEN parent_id IS NULL THEN id ELSE parent_id END, 
            CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, 
            createdAt ASC`, [postId], (err, rows) => {
        if (err) return callback(err, null);

        const comments = [];
        const commentMap = {};

        rows.forEach(comment => {
            comment.replies = [];
            commentMap[comment.id] = comment;
        });

        rows.forEach(comment => {
            if (comment.parent_id === null) {
                comments.push(comment);
            } else {
                const parent = commentMap[comment.parent_id];
                if (parent) parent.replies.push(comment);
            }
        });

        callback(null, comments);
    });
};

// 회원가입
app.get('/register', (req, res) => {
    res.render('register', { title: '회원가입', error: null, username: null });
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    
    if (!passwordRegex.test(password)) {
        return res.render('register', {
            title: '회원가입',
            error: 'password_invalid',
            username
        });
    }

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) return res.status(500).send('비밀번호 해시 처리 중 오류');
        
        db.run(`INSERT INTO users (username, password, createdAt) VALUES (?, ?, ?)`, 
            [username, hashedPassword, new Date().toLocaleString()], err => {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.render('register', {
                        title: '회원가입',
                        error: 'username_exists',
                        username
                    });
                }
                return res.status(500).send('회원가입 실패');
            }
            res.redirect(`/login?registered=success&username=${encodeURIComponent(username)}`);
        });
    });
});

// 로그인
app.get('/login', (req, res) => {
    const showPopup = req.query.registered === 'success';
    const welcomeUser = showPopup ? req.query.username : null;
    res.render('login', { 
        title: '로그인', 
        showPopup, 
        welcomeUser,
        loginError: null,
        username: null
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).send('DB 오류: ' + err.message);

        if (!user) {
            return res.render('login', {
                title: '로그인',
                loginError: '아이디 또는 비밀번호가 일치하지 않습니다.',
                username
            });
        }

        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.status(500).send('비밀번호 오류');

            if (!isMatch) {
                return res.render('login', {
                    title: '로그인',
                    loginError: '아이디 또는 비밀번호가 일치하지 않습니다.',
                    username
                });
            }

            db.run(`UPDATE users SET lastLoginAt = ?, loginCount = COALESCE(loginCount, 0) + 1 WHERE id = ?`, 
                [new Date().toLocaleString(), user.id]);

            req.session.userId = user.id;
            req.session.username = user.username;
            res.redirect('/');
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('로그아웃 실패');
        res.redirect('/login');
    });
});

// 사용자 정보
app.get('/userinfo', requireLogin, (req, res) => {
    const userId = req.session.userId;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(500).send('사용자 정보 조회 실패');
        
        const queries = {
            postCount: `SELECT COUNT(*) as count FROM posts WHERE userId = ?`,
            commentCount: `SELECT COUNT(*) as count FROM comments WHERE userId = ?`,
            recentPosts: `SELECT * FROM posts WHERE userId = ? ORDER BY id DESC LIMIT 5`,
            recentComments: `SELECT * FROM comments WHERE userId = ? ORDER BY id DESC LIMIT 5`
        };

        const results = {};
        let completed = 0;

        Object.keys(queries).forEach(key => {
            if (key === 'postCount' || key === 'commentCount') {
                db.get(queries[key], [userId], (err, result) => {
                    if (err) return res.status(500).send(`${key} 조회 실패`);
                    results[key] = result ? result.count : 0;
                    completed++;

                    if (completed === Object.keys(queries).length) {
                        res.render('userinfo', {
                            title: '사용자 정보',
                            user,
                            postCount: results.postCount,
                            commentCount: results.commentCount,
                            loginCount: user.loginCount || 0,
                            recentPosts: results.recentPosts,
                            recentComments: results.recentComments
                        });
                    }
                });
            } else {
                db.all(queries[key], [userId], (err, result) => {
                    if (err) return res.status(500).send(`${key} 조회 실패`);
                    results[key] = result || [];
                    completed++;

                    if (completed === Object.keys(queries).length) {
                        res.render('userinfo', {
                            title: '사용자 정보',
                            user,
                            postCount: results.postCount,
                            commentCount: results.commentCount,
                            loginCount: user.loginCount || 0,
                            recentPosts: results.recentPosts,
                            recentComments: results.recentComments
                        });
                    }
                });
            }
        });
    });
});

// 메인 페이지
app.get('/', requireLogin, (req, res) => {
    const { q: query, page = 1, board: boardType = 'free' } = req.query;
    const limit = 10;
    const offset = (parseInt(page) - 1) * limit;
    
    // 최신 공지사항 조회
    db.get(`SELECT posts.*, users.username FROM posts JOIN users ON posts.userId = users.id 
            WHERE posts.boardType = 'notice' ORDER BY posts.id DESC LIMIT 1`, (err, latestNotice) => {
        
        let countSql, countParam;
        if (query?.trim()) {
            countSql = `SELECT COUNT(*) as total FROM posts JOIN users ON posts.userId = users.id WHERE posts.boardType = ? AND posts.title LIKE ?`;
            countParam = [boardType, `%${query}%`];
        } else {
            countSql = `SELECT COUNT(*) as total FROM posts WHERE posts.boardType = ?`;
            countParam = [boardType];
        }
        
        db.get(countSql, countParam, (err, countResult) => {
            if (err) return res.status(500).send('DB 오류');
            
            const totalPosts = countResult.total;
            const totalPages = Math.ceil(totalPosts / limit);
            
            let sql, param;
            if (query?.trim()) {
                sql = `SELECT posts.*, users.username FROM posts JOIN users ON posts.userId = users.id WHERE posts.boardType = ? AND posts.title LIKE ? ORDER BY posts.id DESC LIMIT ? OFFSET ?`;
                param = [boardType, `%${query}%`, limit, offset];
            } else {
                sql = `SELECT posts.*, users.username FROM posts JOIN users ON posts.userId = users.id WHERE posts.boardType = ? ORDER BY posts.id DESC LIMIT ? OFFSET ?`;
                param = [boardType, limit, offset];
            }
            
            db.all(sql, param, (err, posts) => {
                if (err) return res.status(500).send('DB 오류');
                
                const pagination = {
                    currentPage: parseInt(page),
                    totalPages,
                    totalPosts,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                    nextPage: parseInt(page) + 1,
                    prevPage: parseInt(page) - 1,
                    startPage: Math.floor((page - 1) / 10) * 10 + 1,
                    endPage: Math.min(Math.floor((page - 1) / 10) * 10 + 10, totalPages)
                };
                
                res.render('index', { 
                    title: getBoardTitle(boardType), 
                    posts, 
                    query,
                    boardType,
                    pagination,
                    latestNotice: latestNotice || null
                });
            });
        });
    });
});

// ================== 글쓰기 라우트 분리 ==================

// 거래게시판 글쓰기 페이지
app.get('/write/trade', requireLogin, (req, res) => {
    res.render('trade-write', { title: '거래글 작성' });
});

// 자유게시판/공지사항 글쓰기 페이지
app.get('/write/free', requireLogin, (req, res) => {
    const boardType = req.query.board || 'free';
    res.render('free-write', { title: '글쓰기', boardType });
});

// 거래게시판 글 작성 처리
app.post('/write/trade', requireLogin, upload.single('image'), (req, res) => {
    const { title, content, auctionInfo } = req.body;
    const userId = req.session.userId;
    const image = req.file ? req.file.filename : null;

    // 제목 검사
    if (!title || title.trim() === '') {
        return res.status(400).send('제목을 입력해주세요.');
    }

    // 내용 검사
    const isEmptyContent = !content || 
                          content.trim() === '' || 
                          content === '<p><br></p>' ||
                          content === '<p></p>' ||
                          content.replace(/<[^>]*>/g, '').trim() === '';

    if (isEmptyContent) {
        return res.status(400).send('내용을 입력해주세요.');
    }

    // 아이템 정보 필수 체크
    if (!auctionInfo || auctionInfo.trim() === '') {
        return res.status(400).send('거래할 아이템을 검색하고 선택해주세요.');
    }

    db.run(
        `INSERT INTO posts (userId, boardType, title, content, image, createdAt, auctionInfo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'deal', title, content, image, new Date().toLocaleString(), auctionInfo],
        err => {
            if (err) return res.status(500).send('글 저장 실패: ' + err.message);
            res.redirect('/?board=deal');
        }
    );
});

// 자유게시판/공지사항 글 작성 처리
app.post('/write/free', requireLogin, upload.single('image'), (req, res) => {
    const { title, content, boardType } = req.body;
    const userId = req.session.userId;
    const image = req.file ? req.file.filename : null;
    const board = boardType || 'free';

    // 제목 검사
    if (!title || title.trim() === '') {
        return res.status(400).send('제목을 입력해주세요.');
    }

    // 내용 검사
    const isEmptyContent = !content || 
                          content.trim() === '' || 
                          content === '<p><br></p>' ||
                          content === '<p></p>' ||
                          content.replace(/<[^>]*>/g, '').trim() === '';

    if (isEmptyContent) {
        return res.status(400).send('내용을 입력해주세요.');
    }

    db.run(
        `INSERT INTO posts (userId, boardType, title, content, image, createdAt, auctionInfo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, board, title, content, image, new Date().toLocaleString(), null],
        err => {
            if (err) return res.status(500).send('글 저장 실패: ' + err.message);
            res.redirect(`/?board=${board}`);
        }
    );
});

// 기존 /write 라우트는 리다이렉트 처리
app.get('/write', requireLogin, (req, res) => {
    const boardType = req.query.board || 'deal';
    
    if (boardType === 'deal') {
        res.redirect('/write/trade');
    } else {
        res.redirect(`/write/free?board=${boardType}`);
    }
});

// 기존 /write POST 요청 처리 (하위 호환성을 위해 유지)
app.post('/write', requireLogin, upload.single('image'), (req, res) => {
    const { title, content, boardType, auctionInfo } = req.body;
    const userId = req.session.userId;
    const image = req.file ? req.file.filename : null;
    const board = boardType || 'deal';

    // 제목 검사
    if (!title || title.trim() === '') {
        return res.status(400).send('제목을 입력해주세요.');
    }

    // 내용 검사
    const isEmptyContent = !content || 
                          content.trim() === '' || 
                          content === '<p><br></p>' ||
                          content === '<p></p>' ||
                          content.replace(/<[^>]*>/g, '').trim() === '';

    if (isEmptyContent) {
        return res.status(400).send('내용을 입력해주세요.');
    }

    // 거래게시판인 경우 아이템 정보 필수 체크
    if (board === 'deal' && (!auctionInfo || auctionInfo.trim() === '')) {
        return res.status(400).send('거래게시판에는 아이템 정보가 필수입니다.\n아이템을 검색하고 선택해주세요.');
    }

    db.run(
        `INSERT INTO posts (userId, boardType, title, content, image, createdAt, auctionInfo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, board, title, content, image, new Date().toLocaleString(), auctionInfo || null],
        err => {
            if (err) return res.status(500).send('글 저장 실패: ' + err.message);
            res.redirect(`/?board=${board}`);
        }
    );
});

// 하위 호환성을 위한 /write/general POST 라우트 추가 (기존 코드와의 호환성)
app.post('/write/general', requireLogin, upload.single('image'), (req, res) => {
    const { title, content, boardType } = req.body;
    const userId = req.session.userId;
    const image = req.file ? req.file.filename : null;
    const board = boardType || 'free';

    // 제목 검사
    if (!title || title.trim() === '') {
        return res.status(400).send('제목을 입력해주세요.');
    }

    // 내용 검사
    const isEmptyContent = !content || 
                          content.trim() === '' || 
                          content === '<p><br></p>' ||
                          content === '<p></p>' ||
                          content.replace(/<[^>]*>/g, '').trim() === '';

    if (isEmptyContent) {
        return res.status(400).send('내용을 입력해주세요.');
    }

    db.run(
        `INSERT INTO posts (userId, boardType, title, content, image, createdAt, auctionInfo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, board, title, content, image, new Date().toLocaleString(), null],
        err => {
            if (err) return res.status(500).send('글 저장 실패: ' + err.message);
            res.redirect(`/?board=${board}`);
        }
    );
});

// ====================================================

// 게시글 상세
app.get('/post/:id', requireLogin, (req, res) => {
    const postId = req.params.id;
    
    db.get(`SELECT posts.*, users.username FROM posts JOIN users ON posts.userId = users.id WHERE posts.id = ?`, 
        [postId], (err, post) => {
            if (err || !post) return res.status(404).send('게시글이 없습니다.');
            
            getHierarchicalComments(postId, (err, comments) => {
                if (err) return res.status(500).send('댓글을 불러오는데 실패했습니다.');
                
                res.render('post', {
                    title: post.title,
                    post,
                    comments,
                    username: req.session.username
                });
            });
        });
});

// 게시글 수정
app.get('/edit/:id', requireLogin, (req, res) => {
    db.get(`SELECT * FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err || !post || post.userId !== req.session.userId) {
            return res.status(403).send('권한이 없습니다.');
        }
        res.render('edit', { post, title: '글 수정' });
    });
});

app.put('/edit/:id', requireLogin, upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? req.file.filename : null;

    db.get(`SELECT * FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err || !post || post.userId !== req.session.userId) {
            return res.status(403).send('권한 없음.');
        }

        const updatedImage = image || post.image;
        db.run(`UPDATE posts SET title = ?, content = ?, image = ? WHERE id = ?`,
            [title, content, updatedImage, req.params.id], err => {
                if (err) return res.status(500).send('수정 실패');
                res.redirect(`/post/${req.params.id}`);
            });
    });
});

// 게시글 삭제
app.delete('/delete/:id', requireLogin, (req, res) => {
    const postId = req.params.id;

    db.get(`SELECT * FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err || !post || post.userId !== req.session.userId) {
            return res.status(403).send('권한 없음');
        }
        
        db.run(`DELETE FROM comments WHERE postId = ?`, [postId], err => {
            if (err) return res.status(500).send('댓글 삭제 실패');
            
            db.run(`DELETE FROM posts WHERE id = ?`, [postId], err => {
                if (err) return res.status(500).send('삭제 실패');
                res.redirect('/');
            });
        });
    });
});

// 댓글 작성
app.post('/post/:id/comment', requireLogin, (req, res) => {
    const postId = req.params.id;
    const { content, parent_id } = req.body;
    const { username, userId } = req.session;
    const createdAt = new Date().toLocaleString();
    
    if (parent_id) {
        db.get(`SELECT depth FROM comments WHERE id = ?`, [parent_id], (err, parentComment) => {
            if (err) return res.redirect(`/post/${postId}`);
            
            const depth = parentComment ? parentComment.depth + 1 : 0;
            if (depth > 2) return res.redirect(`/post/${postId}?error=max_depth`);
            
            db.run(`INSERT INTO comments (postId, userId, username, content, parent_id, depth, createdAt) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [postId, userId, username, content, parent_id, depth, createdAt], 
                () => res.redirect(`/post/${postId}`)
            );
        });
    } else {
        db.run(`INSERT INTO comments (postId, userId, username, content, parent_id, depth, createdAt) 
                VALUES (?, ?, ?, ?, NULL, 0, ?)`, 
            [postId, userId, username, content, createdAt], 
            () => res.redirect(`/post/${postId}`)
        );
    }
});

// 댓글 삭제
app.delete('/comment/:id', requireLogin, (req, res) => {
    const commentId = req.params.id;
    const username = req.session.username;
    
    db.get(`SELECT * FROM comments WHERE id = ? AND username = ?`, [commentId, username], (err, comment) => {
        if (err || !comment) {
            return res.status(403).json({ success: false, message: '권한이 없습니다.' });
        }
        
        db.get(`SELECT COUNT(*) as count FROM comments WHERE parent_id = ?`, [commentId], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
            
            if (result.count > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: '대댓글이 있는 댓글은 삭제할 수 없습니다.' 
                });
            }
            
            db.run(`DELETE FROM comments WHERE id = ?`, [commentId], err => {
                if (err) return res.status(500).json({ success: false, message: '삭제에 실패했습니다.' });
                res.json({ success: true });
            });
        });
    });
});


// 댓글 수정 페이지 이동
app.get('/comment/:id/edit', requireLogin, (req, res) => {
    const commentId = req.params.id;
    const username = req.session.username;
    
    db.get(`SELECT * FROM comments WHERE id = ? AND username = ?`, [commentId, username], (err, comment) => {
        if (err || !comment) {
            return res.status(403).send('권한이 없습니다.');
        }
        
        db.get(`SELECT * FROM posts WHERE id = ?`, [comment.postId], (err, post) => {
            if (err || !post) {
                return res.status(404).send('게시글을 찾을 수 없습니다.');
            }
            
            res.render('edit-comment', { 
                title: '댓글 수정', 
                comment: comment,
                post: post
            });
        });
    });
});

// 댓글 수정 처리
app.put('/comment/:id', requireLogin, (req, res) => {
    const commentId = req.params.id;
    const { content } = req.body;
    const username = req.session.username;
    
    if (!content || content.trim() === '') {
        return res.status(400).send('댓글 내용을 입력해주세요.');
    }
    
    db.get(`SELECT * FROM comments WHERE id = ? AND username = ?`, [commentId, username], (err, comment) => {
        if (err || !comment) {
            return res.status(403).send('권한이 없습니다.');
        }
        
        db.run(`UPDATE comments SET content = ? WHERE id = ?`, [content, commentId], (err) => {
            if (err) {
                return res.status(500).send('댓글 수정에 실패했습니다.');
            }
            
            res.redirect(`/post/${comment.postId}`);
        });
    });
});

app.listen(port, () => {
    console.log(`서버 실행 중: http://localhost:${port}`);
});