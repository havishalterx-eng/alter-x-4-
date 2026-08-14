
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Search } from "lucide-react"

export function ComponentTestPage() {
  return (
    <div className="p-8 space-y-12 max-w-5xl mx-auto pb-24">
      <div>
        <h1 className="text-3xl font-bold mb-2">Component Library Test</h1>
        <p className="text-text-muted">Use this page to verify all design tokens and primitives.</p>
      </div>

      <section>
        <h2 className="text-xl font-semibold mb-4 border-b border-border pb-2">Buttons</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>Loading</Button>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4 border-b border-border pb-2">Badges</h2>
        <div className="flex flex-wrap gap-4">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4 border-b border-border pb-2">Inputs & Forms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="i1">Standard Input</Label>
            <Input id="i1" placeholder="Enter text..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i2">Input with Icon</Label>
            <Input id="i2" leadingIcon={<Search className="h-4 w-4" />} placeholder="Search..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i3">Error Input</Label>
            <Input id="i3" error defaultValue="Invalid value" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s1">Select</Label>
            <Select id="s1">
              <option>Option 1</option>
              <option>Option 2</option>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="t1">Textarea</Label>
            <Textarea id="t1" placeholder="Enter multiline text..." />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="c1" />
            <Label htmlFor="c1">Accept terms and conditions</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch id="sw1" />
            <Label htmlFor="sw1">Enable notifications</Label>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4 border-b border-border pb-2">Cards</h2>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>This is a description for the card to explain its purpose.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Main content of the card goes here. It can contain forms, text, or anything else.</p>
          </CardContent>
          <CardFooter className="justify-end space-x-2">
            <Button variant="ghost">Cancel</Button>
            <Button variant="primary">Submit</Button>
          </CardFooter>
        </Card>
      </section>
    </div>
  )
}
