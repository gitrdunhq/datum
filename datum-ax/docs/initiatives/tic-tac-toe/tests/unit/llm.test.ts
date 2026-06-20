import { getComputerMove } from '../../src/services/llm';
import { describe, it, expect, vi } from 'vitest';

describe('LLM Service', () => {
  it('should return a valid move', async () => {
    const mockBoard = [
      ['X', 'O', ' '],
      [' ', 'X', ' '],
      [' ', ' ', ' '],
    ];

    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({ move: { row: 2, col: 2 } }),
          },
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await getComputerMove(mockBoard);

    expect(result).toEqual({ move: { row: 2, col: 2 } });
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMService } from '../../src/services/llm';

describe('LLMService', () => {
  let service: LLMService;

  beforeEach(() => {
    service = new LLMService({ apiKey: 'test-key' });
  });

  it('should format the board state into a structured prompt', () => {
    const board = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];
    const prompt = service.formatPrompt(board);
    expect(prompt).toContain('Tic-Tac-Toe Board');
    expect(prompt).toContain('0 0 0');
    expect(prompt).toContain('0 1 0');
    expect(prompt).toContain('0 0 0');
  });

  it('should send the prompt to the LLM API', async () => {
    const board = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];
    const mockResponse = JSON.stringify({ move: { row: 0, col: 0 } });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve(JSON.parse(mockResponse)),
    })));

    await service.getMove(board);
