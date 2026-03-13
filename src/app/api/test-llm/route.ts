import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

// 测试 LLM 调用是否正常工作
export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    // 提取转发头（必需）
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    // 创建 LLM 客户端
    // 注意：只设置 baseUrl，不设置 modelBaseUrl，因为 model.coze.com 域名无法解析
    const config = new Config({
      apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
      baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
      timeout: 30000, // 30 秒超时
    });

    console.log('[TEST LLM] Config apiKey:', !!config.apiKey);
    console.log('[TEST LLM] Config baseUrl:', config.baseUrl);
    console.log('[TEST LLM] Config modelBaseUrl:', config.modelBaseUrl);

    const llmClient = new LLMClient(config, customHeaders);

        // 测试调用
    const messages = [
      {
        role: 'user' as const,
        content: prompt || '请说一句话，测试 LLM 是否正常工作。'
      }
    ];

    console.log('[TEST LLM] 开始测试，prompt:', prompt);
    console.log('[TEST LLM] customHeaders:', JSON.stringify(customHeaders));
    console.log('[TEST LLM] 环境变量检查:', {
      COZE_WORKLOAD_IDENTITY_API_KEY: !!process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
      COZE_INTEGRATION_BASE_URL: process.env.COZE_INTEGRATION_BASE_URL,
      COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT: process.env.COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT,
    });

    const response = await llmClient.invoke(messages, {
      model: 'doubao-seed-2-0-lite-260215',
      temperature: 0.7,
    });

    console.log('[TEST LLM] 调用成功，response:', response.content);

    return NextResponse.json({
      success: true,
      content: response.content,
    });

  } catch (error) {
    console.error('[TEST LLM] 调用失败:', error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
