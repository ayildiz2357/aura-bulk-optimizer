import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  useIndexResourceState,
  Text,
  Badge,
  BlockStack,
  Select,
  TextField,
  Modal,
  Thumbnail,
  InlineStack,
  Box,
  Divider,
  Checkbox,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { generateSEOData } from "../lib/openai.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  
  // Enforce Paywall
  await billing.require({
    plans: [MONTHLY_PLAN],
    isTest: true,
    onFailure: async () => {
      try {
        await billing.request({ plan: MONTHLY_PLAN, isTest: true });
      } catch (e: any) {
        console.error("Shopify Billing Error:", JSON.stringify(e, null, 2));
        if (e.errorData) {
          console.error("Shopify Billing userErrors:", JSON.stringify(e.errorData, null, 2));
        }
        throw e;
      }
    },
  });
  
  const response = await admin.graphql(`
    #graphql
    query getProducts {
      products(first: 50) {
        edges {
          node {
            id
            title
            descriptionHtml
            featuredImage {
              url
              altText
            }
            seo {
              title
              description
            }
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const products = responseJson.data.products.edges.map((edge: any) => edge.node);

  return json({ products });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const intent = formData.get("intent") as string;
  
  if (intent === "generate") {
    const selectedProductIds = JSON.parse(formData.get("productIds") as string);
    const toneOfVoice = formData.get("toneOfVoice") as string;
    const extraInstructions = formData.get("extraInstructions") as string;
    const generateMainDescription = formData.get("generateMainDescription") === "true";
    
    const previews = [];
    
    for (const id of selectedProductIds) {
      const productResponse = await admin.graphql(`
        #graphql
        query getProduct($id: ID!) {
          product(id: $id) {
            title
            descriptionHtml
          }
        }
      `, { variables: { id } });
      const productJson = await productResponse.json();
      const product = productJson.data.product;

      try {
        const seoData = await generateSEOData(
          product.title, 
          product.descriptionHtml || "",
          toneOfVoice,
          extraInstructions,
          generateMainDescription
        );
        previews.push({
          id,
          originalTitle: product.title,
          seoTitle: seoData.seoTitle,
          seoDescription: seoData.seoDescription,
          mainDescriptionHtml: seoData.mainDescriptionHtml || ""
        });
      } catch (e) {
        console.error(e);
      }
    }

    return json({ type: "preview", previews });
  }

  if (intent === "save") {
    const productsToSave = JSON.parse(formData.get("productsToSave") as string);
    const results = [];

    for (const prod of productsToSave) {
      try {
        // Construct input conditionally depending on what was generated
        const productInput: any = {
          id: prod.id,
          seo: {
            title: prod.seoTitle,
            description: prod.seoDescription
          }
        };

        if (prod.mainDescriptionHtml && prod.mainDescriptionHtml.length > 0) {
          productInput.descriptionHtml = prod.mainDescriptionHtml;
        }

        await admin.graphql(`
          #graphql
          mutation updateProductSEO($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
              }
            }
          }
        `, {
          variables: { input: productInput }
        });
        results.push({ id: prod.id, status: "success" });
      } catch (e) {
        results.push({ id: prod.id, status: "error" });
      }
    }

    return json({ type: "success", results });
  }

  return json({ type: "error", message: "Unknown intent" }, { status: 400 });
};

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const preSelectedId = searchParams.get("id") || (searchParams.getAll("id[]")[0]);

  const [toneOfVoice, setToneOfVoice] = useState("Professional");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [generateMainDescription, setGenerateMainDescription] = useState(false);
  
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [editablePreviews, setEditablePreviews] = useState<any[]>([]);

  const isSubmitting = fetcher.state !== "idle";

  const resourceName = {
    singular: "product",
    plural: "products",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(products);

  // Auto-select product if opened via Admin Link
  useEffect(() => {
    if (preSelectedId && !selectedResources.includes(preSelectedId)) {
      handleSelectionChange("single", true, preSelectedId);
    }
  }, [preSelectedId]);

  const generatePreviews = () => {
    fetcher.submit(
      { 
        intent: "generate",
        productIds: JSON.stringify(selectedResources),
        toneOfVoice,
        extraInstructions,
        generateMainDescription: String(generateMainDescription)
      },
      { method: "POST" }
    );
  };

  const saveToShopify = () => {
    fetcher.submit(
      {
        intent: "save",
        productsToSave: JSON.stringify(editablePreviews)
      },
      { method: "POST" }
    );
  };

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      const data = fetcher.data as any;
      if (data.type === "preview") {
        setEditablePreviews(data.previews);
        setIsPreviewOpen(true);
      } else if (data.type === "success") {
        setIsPreviewOpen(false);
        clearSelection();
        shopify.toast.show("Successfully saved to Shopify!");
      }
    }
  }, [fetcher.data, fetcher.state, shopify]);

  const handlePreviewChange = (id: string, field: string, value: string) => {
    setEditablePreviews((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const rowMarkup = products.map(
    (product: any, index: number) => {
      const isOptimized = product.seo?.title && product.seo.title.length > 5;
      const imageUrl = product.featuredImage?.url;
      
      return (
        <IndexTable.Row
          id={product.id}
          key={product.id}
          selected={selectedResources.includes(product.id)}
          position={index}
        >
          <IndexTable.Cell>
            <InlineStack gap="300" blockAlign="center">
              <Thumbnail
                source={imageUrl || ImageIcon}
                alt={product.featuredImage?.altText || product.title}
                size="small"
              />
              <Text variant="bodyMd" fontWeight="bold" as="span">
                {product.title}
              </Text>
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {isOptimized ? (
              <Badge tone="success">Optimized</Badge>
            ) : (
              <Badge tone="warning">Pending</Badge>
            )}
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  const promotedBulkActions = [
    {
      content: "Generate AI Previews",
      onAction: generatePreviews,
      disabled: isSubmitting || selectedResources.length === 0
    },
  ];

  return (
    <Page fullWidth>
      <TitleBar title="Aura AI Bulk Optimizer" />
      <Layout>
        {/* Branding Header */}
        <Layout.Section>
          <Card padding="400">
            <InlineStack gap="400" blockAlign="center">
              <div style={{ width: "60px", height: "60px", borderRadius: "12px", overflow: "hidden" }}>
                <img src="/logo.jpg" alt="Aura AI Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <BlockStack gap="100">
                <Text as="h1" variant="headingLg">Aura AI Bulk Optimizer</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Supercharge your store's SEO with advanced AI. Select products below to generate high-converting titles and descriptions.
                </Text>
              </BlockStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* AI Settings */}
        <Layout.Section variant="oneThird">
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">AI Settings</Text>
              <Select
                label="Tone of Voice"
                options={[
                  { label: "Professional", value: "Professional" },
                  { label: "Playful & Fun", value: "Playful" },
                  { label: "Luxury & Premium", value: "Luxury" },
                  { label: "Urgent & Persuasive", value: "Urgent" },
                  { label: "Minimalist & Clean", value: "Minimalist" },
                ]}
                onChange={setToneOfVoice}
                value={toneOfVoice}
              />
              <TextField
                label="Extra Instructions (Optional)"
                value={extraInstructions}
                onChange={setExtraInstructions}
                autoComplete="off"
                placeholder="e.g. Mention that the product is 100% vegan."
                multiline={2}
              />
              <Checkbox
                label="Rewrite Main Product Description (HTML)"
                checked={generateMainDescription}
                onChange={setGenerateMainDescription}
                helpText="If checked, AI will completely rewrite the visible product description on your storefront."
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {/* Product Table */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <Text as="h2" variant="headingMd">Products</Text>
            </Box>
            <Divider />
            <IndexTable
              resourceName={resourceName}
              itemCount={products.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={promotedBulkActions}
              headings={[
                { title: "Product" },
                { title: "SEO Status" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Preview Modal */}
      <Modal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Review AI Generated SEO"
        primaryAction={{
          content: "Save to Shopify",
          onAction: saveToShopify,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsPreviewOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            {editablePreviews.map((preview) => (
              <Card key={preview.id} padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {preview.originalTitle}
                  </Text>
                  <TextField
                    label="SEO Title (Google)"
                    value={preview.seoTitle}
                    onChange={(val) => handlePreviewChange(preview.id, "seoTitle", val)}
                    autoComplete="off"
                  />
                  <TextField
                    label="SEO Description (Google)"
                    value={preview.seoDescription}
                    onChange={(val) => handlePreviewChange(preview.id, "seoDescription", val)}
                    autoComplete="off"
                    multiline={3}
                  />
                  
                  {generateMainDescription && (
                    <TextField
                      label="Main Product Description (HTML)"
                      value={preview.mainDescriptionHtml}
                      onChange={(val) => handlePreviewChange(preview.id, "mainDescriptionHtml", val)}
                      autoComplete="off"
                      multiline={6}
                    />
                  )}
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
