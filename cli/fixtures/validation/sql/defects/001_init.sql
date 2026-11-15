CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL
);

INSERT INTO users VALUES (1, 'a@example.com');

UPDATE users SET email = 'b@example.com';

DELETE FROM users;

SELECT * FROM users;

DROP TABLE sessions;
