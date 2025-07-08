import request from 'supertest';
import app from '../src/server';

describe('Video API', () => {
  let authToken: string;
  let userId: number;

  beforeAll(async () => {
    // Create a test user
    const userResponse = await request(app).post('/user/register').send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });

    userId = userResponse.body.id;

    // Login to get token
    const loginResponse = await request(app).post('/auth/login').send({
      email: 'test@example.com',
      password: 'password123',
    });

    authToken = loginResponse.body.token;
  });

  describe('POST /video', () => {
    it('should create a new video', async () => {
      const response = await request(app)
        .post('/video')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.videoUrl).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
      expect(response.body.status).toBe('pending');
      expect(response.body.userId).toBe(userId);
    });

    it('should require authentication', async () => {
      const response = await request(app).post('/video').send({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /video', () => {
    it('should return user videos', async () => {
      const response = await request(app)
        .get('/video')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/video');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /video/:id', () => {
    it('should return specific video', async () => {
      // First create a video
      const createResponse = await request(app)
        .post('/video')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });

      const videoId = createResponse.body.id;

      const response = await request(app)
        .get(`/video/${videoId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(videoId);
      expect(response.body.videoUrl).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('should return 404 for non-existent video', async () => {
      const response = await request(app)
        .get('/video/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /video/:id/process', () => {
    it('should start video processing', async () => {
      // First create a video
      const createResponse = await request(app)
        .post('/video')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });

      const videoId = createResponse.body.id;

      const response = await request(app)
        .post(`/video/${videoId}/process`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('videoId');
      expect(response.body.videoId).toBe(videoId);
    });
  });
});
