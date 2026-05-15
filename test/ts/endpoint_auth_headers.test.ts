import { validateSession } from '../../src/ts/services/auth';

describe('Auth Headers Injection', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('validateSession should include Authorization header in the request', async () => {
    const mockToken = 'valid_session_token_1234567890';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ valid: true, token: mockToken }),
    });

    const result = await validateSession(mockToken);
    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/session'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': `Bearer ${mockToken}`
        })
      })
    );
  });
});
