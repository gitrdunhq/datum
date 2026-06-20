export interface LLMResponse {
  move: {
    row: number;
    col: number;
  };
}

export async function getComputerMove(board: string[][]): Promise<LLMResponse> {
  const prompt = `You are playing Tic-Tac-Toe. The board state is:
${board.map(row => row.join(' ')).join('\n')}

Return the coordinates of your move in JSON format: {"move": {"row": <row>, "col": <col>}}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

